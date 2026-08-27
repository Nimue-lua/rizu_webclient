import base64
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from replay_server import initialize_database, make_handler


class ReplayServerTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        database_path = str(Path(self.temporary_directory.name) / "scores.sqlite3")
        initialize_database(database_path)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(database_path))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temporary_directory.cleanup()

    def request(self, path, data=None):
        body = None if data is None else json.dumps(data).encode()
        request = urllib.request.Request(
            self.url + path,
            data=body,
            headers={"Content-Type": "application/json"},
        )
        return urllib.request.urlopen(request)

    def test_submit_list_and_download_replay(self):
        replay = b"compressed replay bytes"
        submission = {
            "chart_id": "chart-1",
            "nickname": "Nimue",
            "mode": "mania",
            "score": 123456,
            "accuracy": 0.987,
            "replay": base64.b64encode(replay).decode(),
        }
        with self.request("/scores", submission) as response:
            self.assertEqual(response.status, 201)
            score_id = json.load(response)["id"]

        with self.request("/leaderboard?chart_id=chart-1") as response:
            scores = json.load(response)["scores"]
            self.assertEqual(scores[0]["nickname"], "Nimue")
            self.assertEqual(scores[0]["accuracy"], 0.987)

        with self.request(f"/scores/{score_id}/replay") as response:
            self.assertEqual(response.read(), replay)

    def test_defaults_to_anonymous_and_orders_by_score(self):
        for score in (10, 20):
            self.request(
                "/scores",
                {
                    "chart_id": "chart-1",
                    "score": score,
                    "replay": base64.b64encode(b"replay").decode(),
                },
            ).close()

        with self.request("/leaderboard?chart_id=chart-1") as response:
            scores = json.load(response)["scores"]
            self.assertEqual([score["score"] for score in scores], [20, 10])
            self.assertEqual(scores[0]["nickname"], "Anonymous")


if __name__ == "__main__":
    unittest.main()
