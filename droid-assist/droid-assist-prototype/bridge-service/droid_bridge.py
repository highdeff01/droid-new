"""Droid desktop bridge: performs the prototype's replay steps as real input with pyautogui.

Every endpoint requires the shared secret from DROID_BRIDGE_TOKEN as
``Authorization: Bearer <token>``; a missing or wrong token gets a JSON 401 and nothing runs.
Only CORS preflights (OPTIONS) are answered without it, since browsers never send
credentials on a preflight, and they perform nothing.

Run:  DROID_BRIDGE_TOKEN=<secret> python3 droid_bridge.py   (DROID_BRIDGE_HOST / DROID_BRIDGE_PORT optional)
"""

import base64
import hmac
import io
import json
import os
import re
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UNAUTHORIZED = "unauthorized — missing or wrong bridge token (send Authorization: Bearer <DROID_BRIDGE_TOKEN>)"
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
}
RUN_PATH = re.compile(r"^/api/replay/([\w-]+)$")


def authorized(header, token):
    """Whether an Authorization header carries the bearer token (constant-time compare)."""
    if not token or not header or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[len("Bearer "):].encode(), token.encode())


def _gui():
    import pyautogui  # imported lazily so the server (and its auth) works without a display

    return pyautogui


def perform(step):
    """Performs one native action of the prototype's NativeAction shape with pyautogui."""
    gui = _gui()
    action, x, y = step["action"], step.get("x", 0), step.get("y", 0)
    duration = step.get("durationMs", 0) / 1000
    if action == "click":
        gui.click(x, y)
    elif action == "double_click":
        gui.doubleClick(x, y)
    elif action == "move":
        gui.moveTo(x, y, duration=duration)
    elif action == "drag":
        gui.moveTo(x, y)
        gui.mouseDown()
        gui.moveTo(step["endX"], step["endY"], duration=duration)
        gui.mouseUp()
    elif action == "mouse_down":
        gui.moveTo(x, y)
        gui.mouseDown()
    elif action == "mouse_up":
        gui.mouseUp(x, y)
    elif action == "scroll":
        gui.scroll(500 if step.get("keyPayload") == "up" else -500, x=x, y=y)
    elif action == "type_text":
        gui.write(step.get("text", ""), interval=0.02)
    elif action == "press_key":
        gui.press(step.get("keyPayload", "enter"))
    elif action == "hotkey":
        gui.hotkey(*step.get("keyPayload", "").split("+"))
    elif action != "wait":
        raise ValueError(f"unknown action {action!r}")
    time.sleep(step.get("delayMs", 0) / 1000)


def capture():
    """A desktop screenshot as a PNG data URL with its native size."""
    shot = _gui().screenshot()
    buf = io.BytesIO()
    shot.save(buf, format="PNG")
    return {"image": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(), "width": shot.width, "height": shot.height}


class Bridge:
    """Replay runs and the actions that carry them out (swappable in tests)."""

    def __init__(self, token, perform_step=perform, take_capture=capture):
        self.token = token
        self.perform_step = perform_step
        self.take_capture = take_capture
        self.runs = {}
        self.lock = threading.Lock()

    def start(self, steps):
        run = {"id": uuid.uuid4().hex, "status": "running"}
        with self.lock:
            self.runs[run["id"]] = run
        threading.Thread(target=self._execute, args=(run, steps), daemon=True).start()
        return dict(run)

    def _execute(self, run, steps):
        try:
            for step in steps:
                self.perform_step(step)
            update = {"status": "completed"}
        except Exception as error:  # reported to the client as the run's failure
            update = {"status": "failed", "error": str(error)}
        with self.lock:
            run.update(update)

    def run(self, run_id):
        with self.lock:
            run = self.runs.get(run_id)
            return dict(run) if run else None


def make_handler(bridge):
    """The request handler for `bridge`: token check first, then the route."""

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            for name, value in CORS.items():
                self.send_header(name, value)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _authorized(self):
            if authorized(self.headers.get("Authorization"), bridge.token):
                return True
            self._send(401, {"success": False, "error": UNAUTHORIZED})
            return False

        def _json(self):
            length = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(length) or b"{}")

        def do_OPTIONS(self):
            self.send_response(204)
            for name, value in CORS.items():
                self.send_header(name, value)
            self.end_headers()

        def do_GET(self):
            if not self._authorized():
                return
            if self.path == "/api/health":
                return self._send(200, {"success": True, "status": "ok"})
            match = RUN_PATH.match(self.path)
            run = bridge.run(match.group(1)) if match else None
            if run:
                return self._send(200, {"success": True, "run": run})
            self._send(404, {"success": False, "error": "not found"})

        def do_POST(self):
            if not self._authorized():
                return
            if self.path == "/api/replay":
                steps = self._json().get("steps") or []
                if not isinstance(steps, list) or not steps:
                    return self._send(400, {"success": False, "error": "steps required"})
                return self._send(202, {"success": True, "run": bridge.start(steps)})
            if self.path == "/api/replay/capture":
                try:
                    return self._send(200, {"success": True, "frame": bridge.take_capture()})
                except Exception as error:
                    return self._send(503, {"success": False, "error": f"capture failed: {error}"})
            self._send(404, {"success": False, "error": "not found"})

        def log_message(self, fmt, *args):  # never echo request headers (the token)
            sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    return Handler


def main():
    token = os.environ.get("DROID_BRIDGE_TOKEN", "")
    if not token:
        sys.exit("DROID_BRIDGE_TOKEN is not set — refusing to start an unauthenticated input bridge")
    host = os.environ.get("DROID_BRIDGE_HOST", "127.0.0.1")
    port = int(os.environ.get("DROID_BRIDGE_PORT", "3000"))
    server = ThreadingHTTPServer((host, port), make_handler(Bridge(token)))
    print(f"Droid bridge on http://{host}:{port} (token required)")
    server.serve_forever()


if __name__ == "__main__":
    main()
