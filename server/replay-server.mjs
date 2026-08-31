#!/usr/bin/env node
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BODY_SIZE = 5 * 1024 * 1024;
const MAX_RESULTS = 50;
const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
  }).end(body);
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function passwordHash(password, salt = randomBytes(16)) {
  return `${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}

function passwordMatches(password, stored) {
  const [salt_hex, expected_hex] = stored.split(":");
  if (!salt_hex || !expected_hex) return false;
  const expected = Buffer.from(expected_hex, "hex");
  const actual = scryptSync(password, Buffer.from(salt_hex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function boundedLimit(value, fallback = MAX_RESULTS) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), MAX_RESULTS) : fallback;
}

async function readJson(request) {
  const content_length = Number(request.headers["content-length"] ?? 0);
  if (!Number.isInteger(content_length) || content_length <= 0 || content_length > MAX_BODY_SIZE) {
    throw Object.assign(new Error("Request body must be between 1 byte and 5 MiB"), { status: 413 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) throw Object.assign(new Error("Request body is too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), { status: 400 });
  }
}

function credentials(payload) {
  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  if (name.length < 2 || name.length > 24) {
    throw Object.assign(new Error("Name must contain between 2 and 24 characters"), { status: 400 });
  }
  if (password.length < 6 || password.length > 200) {
    throw Object.assign(new Error("Password must contain between 6 and 200 characters"), { status: 400 });
  }
  return { name, password };
}

function scoreFromRow(row) {
  const metadata = JSON.parse(row.metadata_json);
  return {
    ...metadata,
    id: row.id,
    nickname: row.user_name ?? "Anonymous",
    played_at: row.played_at,
    submitted_at: row.submitted_at,
    registered: row.user_id !== null,
    replay_url: `/api/scores/${row.id}/replay`,
    difficulty: 0,
    pp: 0,
  };
}

export function openReplayDatabase(database_path) {
  const database = new DatabaseSync(database_path);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY,
      chart_md5 TEXT NOT NULL CHECK(length(chart_md5) = 32),
      chart_index INTEGER NOT NULL CHECK(chart_index >= 1),
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      mode TEXT NOT NULL,
      accuracy REAL,
      score REAL,
      played_at TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      replay BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS scores_chart_ranking_idx
      ON scores(chart_md5, chart_index, accuracy DESC, score DESC, id ASC);
    CREATE INDEX IF NOT EXISTS scores_recent_idx ON scores(id DESC);
    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  `);
  return database;
}

function authenticatedUser(database, request) {
  const match = request.headers.authorization?.match(/^Bearer (\S+)$/);
  if (!match) return null;
  return database.prepare(`
    SELECT users.id, users.name
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash(match[1]), Math.floor(Date.now() / 1000)) ?? null;
}

function createSession(database, user_id) {
  const token = randomBytes(32).toString("base64url");
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Math.floor(Date.now() / 1000));
  database.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(
    tokenHash(token), user_id, Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS,
  );
  return token;
}

const SCORE_SELECT = `
  SELECT scores.*, users.name AS user_name
  FROM scores LEFT JOIN users ON users.id = scores.user_id
`;

export function createReplayServer({ database_path = "scores.sqlite", database: supplied_database } = {}) {
  const database = supplied_database ?? openReplayDatabase(database_path);
  const owns_database = !supplied_database;

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Origin": "*",
        }).end();
        return;
      }

      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/api/health") {
        json(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/register") {
        const { name, password } = credentials(await readJson(request));
        let result;
        try {
          result = database.prepare("INSERT INTO users (name, password_hash, created_at) VALUES (?, ?, ?)")
            .run(name, passwordHash(password), new Date().toISOString());
        } catch (reason) {
          if (String(reason).includes("UNIQUE constraint failed")) {
            json(response, 409, { error: "Name is already registered" });
            return;
          }
          throw reason;
        }
        const user = { id: Number(result.lastInsertRowid), name };
        json(response, 201, { user, token: createSession(database, user.id) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/login") {
        const { name, password } = credentials(await readJson(request));
        const user = database.prepare("SELECT id, name, password_hash FROM users WHERE name = ? COLLATE NOCASE").get(name);
        if (!user || !passwordMatches(password, user.password_hash)) {
          json(response, 401, { error: "Invalid name or password" });
          return;
        }
        json(response, 200, { user: { id: user.id, name: user.name }, token: createSession(database, user.id) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/me") {
        const user = authenticatedUser(database, request);
        json(response, 200, { user });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/logout") {
        const match = request.headers.authorization?.match(/^Bearer (\S+)$/);
        if (match) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(match[1]));
        json(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/scores") {
        const payload = await readJson(request);
        if (typeof payload?.chart_md5 !== "string" || !/^[a-f\d]{32}$/i.test(payload.chart_md5) ||
          !Number.isInteger(payload.chart_index) || payload.chart_index < 1 ||
          (payload.mode !== "mania" && payload.mode !== "osu") || typeof payload.replay !== "string") {
          json(response, 400, { error: "Score requires chart_md5, chart_index, mode, and Base64 replay" });
          return;
        }
        const replay = Buffer.from(payload.replay, "base64");
        const user = authenticatedUser(database, request);
        const played_at = typeof payload.played_at === "string" ? payload.played_at : new Date().toISOString();
        const submitted_at = new Date().toISOString();
        const metadata = { ...payload };
        delete metadata.replay;
        delete metadata.nickname;
        const result = database.prepare(`
          INSERT INTO scores (chart_md5, chart_index, user_id, mode, accuracy, score, played_at,
            submitted_at, metadata_json, replay) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(payload.chart_md5.toLowerCase(), payload.chart_index, user?.id ?? null, payload.mode,
          typeof payload.accuracy === "number" ? payload.accuracy : null,
          typeof payload.score === "number" ? payload.score : null,
          played_at, submitted_at, JSON.stringify(metadata), replay);
        json(response, 201, { id: Number(result.lastInsertRowid), submitted_at });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/leaderboard") {
        const chart_md5 = url.searchParams.get("chart_md5");
        const chart_index = Number(url.searchParams.get("chart_index"));
        if (!chart_md5 || !/^[a-f\d]{32}$/i.test(chart_md5) || !Number.isInteger(chart_index) || chart_index < 1) {
          json(response, 400, { error: "chart_md5 and chart_index are required" });
          return;
        }
        const ranked_rows = database.prepare(`${SCORE_SELECT}
          WHERE scores.chart_md5 = ? AND scores.chart_index = ?
          ORDER BY scores.accuracy DESC, scores.score DESC, scores.id ASC
        `).all(chart_md5.toLowerCase(), chart_index);
        const ranked_users = new Set();
        const rows = ranked_rows.filter((row) => {
          if (row.user_id === null) return true;
          if (ranked_users.has(row.user_id)) return false;
          ranked_users.add(row.user_id);
          return true;
        }).slice(0, boundedLimit(url.searchParams.get("limit")));
        json(response, 200, { scores: rows.map(scoreFromRow) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/scores/recent") {
        const rows = database.prepare(`${SCORE_SELECT} ORDER BY scores.id DESC LIMIT ?`)
          .all(boundedLimit(url.searchParams.get("limit")));
        json(response, 200, { scores: rows.map(scoreFromRow) });
        return;
      }

      const replay_match = request.method === "GET" && url.pathname.match(/^\/api\/scores\/(\d+)\/replay$/);
      if (replay_match) {
        const row = database.prepare("SELECT replay FROM scores WHERE id = ?").get(Number(replay_match[1]));
        if (!row) {
          json(response, 404, { error: "Replay not found" });
          return;
        }
        response.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Content-Length": row.replay.length,
          "Content-Type": "application/octet-stream",
        }).end(row.replay);
        return;
      }

      json(response, 404, { error: "Not found" });
    } catch (reason) {
      const status = reason && typeof reason === "object" && "status" in reason ? Number(reason.status) : 500;
      if (status === 500) console.error(reason);
      json(response, status, { error: status === 500 ? "Internal server error" : String(reason.message) });
    }
  });
  server.on("close", () => { if (owns_database) database.close(); });
  return server;
}

const is_main = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (is_main) {
  const database_path = process.env.RIZU_DATABASE ?? process.argv[2] ?? "scores.sqlite";
  const port = Number(process.env.PORT ?? process.argv[3] ?? 8765);
  const host = process.env.HOST ?? "127.0.0.1";
  createReplayServer({ database_path }).listen(port, host, () => {
    console.log(`Rizu API listening on http://${host}:${port}`);
  });
}
