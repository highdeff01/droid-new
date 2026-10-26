import json
import os
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(__file__))
from droid_bridge import Bridge, authorized, make_handler  # noqa: E402

TOKEN = "s3cret-token"


class BridgeAuthTest(unittest.TestCase):
    def setUp(self):
        self.performed = []
        bridge = Bridge(TOKEN, perform_step=self.performed.append, take_capture=lambda: {"image": "data:image/png;base64,AA==", "width": 2, "height": 1})
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(bridge))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def call(self, method, path, token=None, body=None):
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req) as res:
                return res.status, json.loads(res.read() or b"null")
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read() or b"null")

    def test_every_endpoint_rejects_a_missing_or_wrong_token_with_401(self):
        endpoints = [("GET", "/api/health", None), ("GET", "/api/replay/abc", None), ("POST", "/api/replay", {"steps": [{"action": "click", "x": 1, "y": 1}]}), ("POST", "/api/replay/capture", {}), ("GET", "/nope", None)]
        for method, path, body in endpoints:
            for token in (None, "wrong", ""):
                status, reply = self.call(method, path, token, body)
                self.assertEqual(status, 401, (method, path, token))
                self.assertFalse(reply["success"])
                self.assertIn("unauthorized", reply["error"])
                self.assertNotIn(TOKEN, reply["error"])
        self.assertEqual(self.performed, [])

    def test_the_right_token_runs_a_replay_to_completion(self):
        self.assertEqual(self.call("GET", "/api/health", TOKEN)[0], 200)
        status, reply = self.call("POST", "/api/replay", TOKEN, {"steps": [{"action": "click", "x": 5, "y": 6}]})
        self.assertEqual(status, 202)
        run_id = reply["run"]["id"]
        for _ in range(50):
            _, polled = self.call("GET", f"/api/replay/{run_id}", TOKEN)
            if polled["run"]["status"] != "running":
                break
            time.sleep(0.02)
        self.assertEqual(polled["run"]["status"], "completed")
        self.assertEqual(self.performed, [{"action": "click", "x": 5, "y": 6}])
        status, shot = self.call("POST", "/api/replay/capture", TOKEN, {})
        self.assertEqual((status, shot["frame"]["width"]), (200, 2))

    def test_preflight_needs_no_token_and_allows_the_authorization_header(self):
        req = urllib.request.Request(self.base + "/api/replay", method="OPTIONS")
        with urllib.request.urlopen(req) as res:
            self.assertEqual(res.status, 204)
            self.assertIn("Authorization", res.headers["Access-Control-Allow-Headers"])
        self.assertEqual(self.performed, [])

    def test_authorized_requires_a_configured_token_and_the_bearer_scheme(self):
        self.assertTrue(authorized(f"Bearer {TOKEN}", TOKEN))
        self.assertFalse(authorized(TOKEN, TOKEN))
        self.assertFalse(authorized("Bearer ", ""))
        self.assertFalse(authorized(None, TOKEN))


if __name__ == "__main__":
    unittest.main()
