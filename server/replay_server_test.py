import base64
import json
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from replay_server import initialize_database, make_handler, play_pp


class ReplayServerTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        database_path = str(Path(self.temporary_directory.name) / "scores.sqlite3")
        catalog_path = str(Path(self.temporary_directory.name) / "catalog.sqlite3")
        initialize_database(database_path)
        with sqlite3.connect(catalog_path) as catalog:
            catalog.execute("CREATE TABLE charts (id TEXT PRIMARY KEY, difficulty REAL NOT NULL)")
            catalog.executemany("INSERT INTO charts VALUES (?, ?)", (("chart-1", 5), ("chart-2", 10)))
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(database_path, catalog_path))
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

    def test_defaults_to_anonymous_and_orders_by_accuracy(self):
        for score, accuracy in ((20, 0.8), (10, 0.9)):
            self.request(
                "/scores",
                {
                    "chart_id": "chart-1",
                    "score": score,
                    "accuracy": accuracy,
                    "replay": base64.b64encode(b"replay").decode(),
                },
            ).close()

        with self.request("/leaderboard?chart_id=chart-1") as response:
            scores = json.load(response)["scores"]
            self.assertEqual([score["accuracy"] for score in scores], [0.9, 0.8])
            self.assertEqual(scores[0]["nickname"], "Anonymous")

    def test_caps_leaderboard_at_50_scores(self):
        replay = base64.b64encode(b"replay").decode()
        for accuracy in range(51):
            self.request(
                "/scores",
                {"chart_id": "chart-1", "accuracy": accuracy, "replay": replay},
            ).close()

        with self.request("/leaderboard?chart_id=chart-1&limit=100") as response:
            scores = json.load(response)["scores"]
            self.assertEqual(len(scores), 50)
            self.assertEqual(scores[0]["accuracy"], 50)
            self.assertEqual(scores[-1]["accuracy"], 1)

    def test_calculates_pp_and_global_rankings(self):
        replay = base64.b64encode(b"replay").decode()
        for nickname, chart_id, accuracy in (
            ("Alice", "chart-1", 1),
            ("Alice", "chart-1", 0.5),
            ("Alice", "chart-2", 0.9),
            ("Bob", "chart-1", 0.95),
        ):
            self.request(
                "/scores",
                {"chart_id": chart_id, "nickname": nickname, "accuracy": accuracy, "replay": replay},
            ).close()

        with self.request("/leaderboard?chart_id=chart-1") as response:
            scores = json.load(response)["scores"]
            self.assertEqual(scores[0]["difficulty"], 5)
            self.assertEqual(scores[0]["pp"], round(play_pp(5, 1), 2))
        with self.request("/rankings") as response:
            players = json.load(response)["players"]
            self.assertEqual([player["nickname"] for player in players], ["Alice", "Bob"])
            self.assertEqual(players[0]["play_count"], 2)
            expected = play_pp(10, 0.9) + play_pp(5, 1) * 0.95
            self.assertEqual(players[0]["pp"], round(expected, 2))


if __name__ == "__main__":
    unittest.main()
