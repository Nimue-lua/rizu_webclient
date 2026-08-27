#!/usr/bin/env python3
import argparse
import base64
import binascii
import json
import sqlite3
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


MAX_BODY_SIZE = 5 * 1024 * 1024


def open_database(path):
    database = sqlite3.connect(path)
    database.row_factory = sqlite3.Row
    return database


def initialize_database(path):
    with open_database(path) as database:
        database.execute("PRAGMA journal_mode=WAL")
        database.executescript(
            """
            CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chart_id TEXT NOT NULL,
                nickname TEXT NOT NULL,
                mode TEXT,
                score REAL,
                metadata_json TEXT NOT NULL,
                replay BLOB NOT NULL,
                submitted_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS scores_leaderboard
                ON scores(chart_id, mode, score DESC);
            """
        )


def make_handler(database_path):
    class ReplayHandler(BaseHTTPRequestHandler):
        server_version = "RizuReplayServer/1"

        def send_json(self, status, value):
            body = json.dumps(value, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.end_headers()

        def do_POST(self):
            if urlparse(self.path).path != "/scores":
                self.send_json(404, {"error": "Not found"})
                return

            try:
                content_length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self.send_json(400, {"error": "Invalid Content-Length"})
                return
            if content_length <= 0 or content_length > MAX_BODY_SIZE:
                self.send_json(413, {"error": "Request body must be between 1 byte and 5 MiB"})
                return

            try:
                payload = json.loads(self.rfile.read(content_length))
                chart_id = str(payload["chart_id"])
                replay = base64.b64decode(payload["replay"])
            except (json.JSONDecodeError, KeyError, TypeError, ValueError, binascii.Error):
                self.send_json(400, {"error": "Expected JSON with chart_id and a Base64 replay"})
                return

            nickname = str(payload.get("nickname") or "Anonymous")
            mode = payload.get("mode")
            score = payload.get("score")
            submitted_at = datetime.now(timezone.utc).isoformat()
            metadata = {key: value for key, value in payload.items() if key != "replay"}
            metadata["chart_id"] = chart_id
            metadata["nickname"] = nickname

            try:
                with open_database(database_path) as database:
                    cursor = database.execute(
                        """
                        INSERT INTO scores
                            (chart_id, nickname, mode, score, metadata_json, replay, submitted_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            chart_id,
                            nickname,
                            mode,
                            score,
                            json.dumps(metadata, separators=(",", ":")),
                            replay,
                            submitted_at,
                        ),
                    )
                    score_id = cursor.lastrowid
            except (sqlite3.Error, TypeError, ValueError):
                self.send_json(400, {"error": "Score metadata could not be stored"})
                return

            self.send_json(201, {"id": score_id, "submitted_at": submitted_at})

        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path == "/health":
                self.send_json(200, {"ok": True})
                return
            if parsed.path == "/leaderboard":
                self.get_leaderboard(parse_qs(parsed.query))
                return
            if parsed.path.startswith("/scores/") and parsed.path.endswith("/replay"):
                self.get_replay(parsed.path)
                return
            self.send_json(404, {"error": "Not found"})

        def get_leaderboard(self, query):
            chart_id = query.get("chart_id", [None])[0]
            if chart_id is None:
                self.send_json(400, {"error": "chart_id is required"})
                return
            mode = query.get("mode", [None])[0]
            try:
                limit = min(max(int(query.get("limit", ["100"])[0]), 1), 100)
            except ValueError:
                limit = 100

            sql = "SELECT id, metadata_json, submitted_at FROM scores WHERE chart_id = ?"
            parameters = [chart_id]
            if mode is not None:
                sql += " AND mode = ?"
                parameters.append(mode)
            sql += " ORDER BY score DESC, id ASC LIMIT ?"
            parameters.append(limit)
            with open_database(database_path) as database:
                rows = database.execute(sql, parameters).fetchall()

            scores = []
            for row in rows:
                score = json.loads(row["metadata_json"])
                score.update(
                    {
                        "id": row["id"],
                        "submitted_at": row["submitted_at"],
                        "replay_url": f"/api/scores/{row['id']}/replay",
                    }
                )
                scores.append(score)
            self.send_json(200, {"scores": scores})

        def get_replay(self, path):
            try:
                score_id = int(path.removeprefix("/scores/").removesuffix("/replay").strip("/"))
            except ValueError:
                self.send_json(404, {"error": "Not found"})
                return
            with open_database(database_path) as database:
                row = database.execute("SELECT replay FROM scores WHERE id = ?", (score_id,)).fetchone()
            if row is None:
                self.send_json(404, {"error": "Replay not found"})
                return

            replay = row["replay"]
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(replay)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(replay)

        def log_message(self, message, *args):
            print(f"{self.address_string()} - {message % args}")

    return ReplayHandler


def main():
    parser = argparse.ArgumentParser(description="Store Rizu scores and replays")
    parser.add_argument("--database", default="scores.sqlite3")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    arguments = parser.parse_args()

    initialize_database(arguments.database)
    server = ThreadingHTTPServer((arguments.host, arguments.port), make_handler(arguments.database))
    print(f"Listening on http://{arguments.host}:{arguments.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
