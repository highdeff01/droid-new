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


class AssistMailboxTest(unittest.TestCase):
    def setUp(self):
        self.bridge = Bridge(TOKEN, perform_step=lambda step: None, take_capture=lambda: {"image": "x", "width": 1, "height": 1})
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.bridge))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def call(self, method, path, token=TOKEN, body=None):
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

    def test_every_new_endpoint_rejects_a_missing_or_wrong_token_with_401(self):
        endpoints = [
            ("POST", "/api/assist/status", {"armed": True}),
            ("GET", "/api/assist/status", None),
            ("POST", "/api/assist/requests", {"id": "snip"}),
            ("GET", "/api/assist/requests", None),
            ("GET", "/api/assist/requests/abc", None),
            ("POST", "/api/assist/requests/abc/result", {"ok": True, "result": "done"}),
        ]
        for method, path, body in endpoints:
            for token in (None, "wrong", ""):
                status, reply = self.call(method, path, token, body)
                self.assertEqual(status, 401, (method, path, token))
                self.assertFalse(reply["success"])

    def test_status_round_trip_is_404_before_and_200_after_posting(self):
        status, reply = self.call("GET", "/api/assist/status")
        self.assertEqual(status, 404)
        self.assertEqual(reply["error"], "assist app has not reported status yet")
        snapshot = {"armed": True, "running": False, "goal": "test"}
        self.assertEqual(self.call("POST", "/api/assist/status", body=snapshot), (200, {"success": True}))
        status, reply = self.call("GET", "/api/assist/status")
        self.assertEqual((status, reply["status"]), (200, snapshot))

    def test_posting_a_non_object_status_is_rejected_with_400(self):
        status, reply = self.call("POST", "/api/assist/status", body=[1, 2])
        self.assertEqual(status, 400)
        self.assertFalse(reply["success"])

    def test_a_request_is_delivered_once_then_not_again(self):
        status, reply = self.call("POST", "/api/assist/requests", body={"id": "snip", "params": {"x": 1}})
        self.assertEqual(status, 202)
        request_id = reply["request"]["requestId"]
        self.assertEqual(reply["request"]["status"], "pending")
        status, reply = self.call("GET", "/api/assist/requests")
        self.assertEqual(status, 200)
        self.assertEqual([r["requestId"] for r in reply["requests"]], [request_id])
        self.assertEqual(reply["requests"][0]["status"], "running")
        status, reply = self.call("GET", "/api/assist/requests")
        self.assertEqual((status, reply["requests"]), (200, []))

    def test_requests_are_delivered_in_creation_order(self):
        first = self.call("POST", "/api/assist/requests", body={"id": "a"})[1]["request"]["requestId"]
        second = self.call("POST", "/api/assist/requests", body={"id": "b"})[1]["request"]["requestId"]
        _, reply = self.call("GET", "/api/assist/requests")
        self.assertEqual([r["requestId"] for r in reply["requests"]], [first, second])

    def test_result_post_updates_the_request_to_done_or_failed(self):
        request_id = self.call("POST", "/api/assist/requests", body={"id": "snip"})[1]["request"]["requestId"]
        status, reply = self.call("POST", f"/api/assist/requests/{request_id}/result", body={"ok": True, "result": "cropped"})
        self.assertEqual(status, 200)
        self.assertEqual(reply["request"]["status"], "done")
        self.assertEqual(reply["request"]["result"], "cropped")
        status, reply = self.call("GET", f"/api/assist/requests/{request_id}")
        self.assertEqual((status, reply["request"]["status"], reply["request"]["result"]), (200, "done", "cropped"))

        failing_id = self.call("POST", "/api/assist/requests", body={"id": "snip"})[1]["request"]["requestId"]
        status, reply = self.call("POST", f"/api/assist/requests/{failing_id}/result", body={"ok": False, "result": "refused"})
        self.assertEqual((status, reply["request"]["status"]), (200, "failed"))

    def test_missing_id_or_non_object_params_is_400(self):
        self.assertEqual(self.call("POST", "/api/assist/requests", body={})[0], 400)
        self.assertEqual(self.call("POST", "/api/assist/requests", body={"id": ""})[0], 400)
        self.assertEqual(self.call("POST", "/api/assist/requests", body={"id": "snip", "params": [1]})[0], 400)

    def test_unknown_request_id_is_404(self):
        self.assertEqual(self.call("GET", "/api/assist/requests/nope")[0], 404)
        self.assertEqual(self.call("POST", "/api/assist/requests/nope/result", body={"ok": True, "result": "x"})[0], 404)


if __name__ == "__main__":
    unittest.main()
