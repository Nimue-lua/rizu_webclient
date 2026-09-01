#!/usr/bin/env node
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BODY_SIZE = 5 * 1024 * 1024;
const MAX_RESULTS = 50;
const SKILL_PLAY_COUNT = 20;
const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_CATALOG_URL = "https://s3.kuudere.fun/catalog.sqlite";
const DEFAULT_CATALOG_PATH = "server/replay-server/catalog.sqlite";

type JsonObject = Record<string, unknown>;

interface UserRow {
  id: number;
  name: string;
}

interface LoginRow extends UserRow {
  password_hash: string;
}

interface ScoreRow {
  id: number;
  user_id: number | null;
  user_name: string | null;
  played_at: string;
  submitted_at: string;
  metadata_json: string;
}

interface CatalogChartRow {
  background_preview_path: string | null;
  difficulty: number;
  speed: number | null;
  dexterity: number | null;
  stamina: number | null;
  technical: number | null;
  mode: number;
  keys: number | null;
  name: string;
  title: string;
  artist: string;
}

const SKILLS = ["speed", "dexterity", "stamina", "technical"] as const;
type Skill = typeof SKILLS[number];

interface RankedSkillPlay {
  user_id: number;
  nickname: string;
  chart_id: string;
  rating: number;
}

interface ReplayRow {
  replay: Uint8Array;
}

interface ReplayServerOptions {
  database_path?: string;
  database?: DatabaseSync;
  catalog_path?: string;
  catalog?: DatabaseSync;
  app_html?: string;
  asset_base_url?: string;
}

interface HttpError extends Error {
  status: number;
}

function httpError(message: string, status: number): HttpError {
  return Object.assign(new Error(message), { status });
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
  }).end(body);
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] as string);
}

function chartPageHtml(template: string, chart: CatalogChartRow, page_url: string, image_url: string | null): string {
  const title = `${chart.artist} - ${chart.title}`;
  const description = `${chart.name} - ${chart.difficulty.toFixed(2)} difficulty`;
  const metadata = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Rizu">`,
    `<meta property="og:title" content="${htmlEscape(title)}">`,
    `<meta property="og:description" content="${htmlEscape(description)}">`,
    `<meta property="og:url" content="${htmlEscape(page_url)}">`,
    ...(image_url ? [
      `<meta property="og:image" content="${htmlEscape(image_url)}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
    ] : []),
  ].join("\n    ");
  return template
    .replace(/<title>.*?<\/title>/s, `<title>${htmlEscape(title)} | Rizu</title>`)
    .replace("</head>", `    ${metadata}\n  </head>`);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function passwordHash(password: string, salt = randomBytes(16)): string {
  return `${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const [salt_hex, expected_hex] = stored.split(":");
  if (!salt_hex || !expected_hex) return false;
  const expected = Buffer.from(expected_hex, "hex");
  const actual = scryptSync(password, Buffer.from(salt_hex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function boundedLimit(value: string | null | undefined, fallback = MAX_RESULTS): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), MAX_RESULTS) : fallback;
}

async function readJson(request: IncomingMessage): Promise<JsonObject> {
  const content_length = Number(request.headers["content-length"] ?? 0);
  if (!Number.isInteger(content_length) || content_length <= 0 || content_length > MAX_BODY_SIZE) {
    throw httpError("Request body must be between 1 byte and 5 MiB", 413);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += bytes.length;
    if (size > MAX_BODY_SIZE) throw httpError("Request body is too large", 413);
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonObject;
  } catch {
    throw httpError("Request body must be valid JSON", 400);
  }
}

function credentials(payload: JsonObject): { name: string; password: string } {
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (name.length < 2 || name.length > 24) {
    throw httpError("Name must contain between 2 and 24 characters", 400);
  }
  if (password.length < 6 || password.length > 200) {
    throw httpError("Password must contain between 6 and 200 characters", 400);
  }
  return { name, password };
}

export function skillRating(difficulty: unknown, accuracy: unknown): number {
  const safe_difficulty = typeof difficulty === "number" && Number.isFinite(difficulty)
    ? Math.max(0, difficulty)
    : 0;
  const safe_accuracy = typeof accuracy === "number" && Number.isFinite(accuracy)
    ? Math.min(1, Math.max(0, accuracy))
    : 0;
  if (safe_accuracy <= 0.8) return 0;
  if (safe_accuracy === 0.9) return safe_difficulty * 0.5;
  if (safe_accuracy === 0.95) return safe_difficulty;
  if (safe_accuracy <= 0.9) return safe_difficulty * (safe_accuracy - 0.8) * 5;
  if (safe_accuracy <= 0.95) return safe_difficulty * (0.5 + (safe_accuracy - 0.9) * 10);
  if (safe_accuracy < 1) return safe_difficulty + (safe_accuracy - 0.95) * 40;
  return safe_difficulty + 2;
}

function catalogChart(catalog: DatabaseSync, chart_md5: string, chart_index: number): CatalogChartRow | undefined {
  return catalog.prepare(`
    SELECT charts.difficulty, charts.speed, charts.dexterity, charts.stamina, charts.technical,
      charts.mode, charts.keys, charts.name, charts.background_preview_path, songs.title, songs.artist
    FROM charts JOIN songs ON songs.id = charts.song_id
    WHERE charts.chart_md5 = ? AND charts.chart_index = ?
  `).get(chart_md5.toLowerCase(), chart_index) as unknown as CatalogChartRow | undefined;
}

function skillLeaderboards(database: DatabaseSync, catalog: DatabaseSync): Record<Skill, JsonObject[]> {
  const rows = database.prepare(`${SCORE_SELECT}
    WHERE scores.user_id IS NOT NULL AND scores.accuracy IS NOT NULL
  `).all() as unknown as ScoreRow[];
  const plays: Record<Skill, RankedSkillPlay[]> = { speed: [], dexterity: [], stamina: [], technical: [] };

  for (const row of rows) {
    const metadata = JSON.parse(row.metadata_json) as JsonObject;
    if (typeof metadata.chart_md5 !== "string" || typeof metadata.chart_index !== "number" ||
      typeof metadata.accuracy !== "number" || !Number.isFinite(metadata.accuracy)) continue;
    const chart = catalogChart(catalog, metadata.chart_md5, metadata.chart_index);
    if (!chart) continue;
    const chart_id = `${metadata.chart_md5.toLowerCase()}:${metadata.chart_index}`;
    for (const skill of SKILLS) {
      const difficulty = chart[skill];
      if (difficulty === null || !Number.isFinite(difficulty)) continue;
      plays[skill].push({
        user_id: row.user_id as number,
        nickname: row.user_name ?? "Unknown player",
        chart_id,
        rating: skillRating(difficulty, metadata.accuracy),
      });
    }
  }

  const leaderboards: Record<Skill, JsonObject[]> = { speed: [], dexterity: [], stamina: [], technical: [] };
  for (const skill of SKILLS) {
    const best_plays = new Map<string, RankedSkillPlay>();
    for (const play of plays[skill]) {
      const key = `${play.user_id}:${play.chart_id}`;
      if (play.rating > (best_plays.get(key)?.rating ?? -1)) best_plays.set(key, play);
    }
    const players = new Map<number, { nickname: string; ratings: number[] }>();
    for (const play of best_plays.values()) {
      const player = players.get(play.user_id) ?? { nickname: play.nickname, ratings: [] };
      player.ratings.push(play.rating);
      players.set(play.user_id, player);
    }
    const ranking = [...players.entries()].map(([user_id, player]) => {
      player.ratings.sort((left, right) => right - left);
      const top_ratings = player.ratings.slice(0, SKILL_PLAY_COUNT);
      return {
        user_id,
        nickname: player.nickname,
        rating: Math.round(top_ratings.reduce((sum, value) => sum + value, 0) / SKILL_PLAY_COUNT * 100) / 100,
        play_count: top_ratings.length,
      };
    }).filter((player) => player.rating > 0)
      .sort((left, right) => right.rating - left.rating || left.nickname.localeCompare(right.nickname))
      .slice(0, MAX_RESULTS)
      .map((player, index) => ({ ...player, rank: index + 1 }));
    leaderboards[skill] = ranking;
  }
  return leaderboards;
}

function scoreFromRow(row: ScoreRow, catalog: DatabaseSync): JsonObject {
  const metadata = JSON.parse(row.metadata_json) as JsonObject;
  const chart = typeof metadata.chart_md5 === "string" && typeof metadata.chart_index === "number"
    ? catalogChart(catalog, metadata.chart_md5, metadata.chart_index)
    : undefined;
  const max_skill_difficulty = Math.max(0, ...SKILLS.map((skill) => chart?.[skill] ?? 0));
  return {
    ...metadata,
    id: row.id,
    nickname: row.user_name ?? "Anonymous",
    played_at: row.played_at,
    submitted_at: row.submitted_at,
    registered: row.user_id !== null,
    replay_url: `/api/scores/${row.id}/replay`,
    difficulty: chart?.difficulty ?? 0,
    max_skill_difficulty,
    keys: chart?.keys ?? null,
    chart_name: chart?.name ?? "Unknown difficulty",
    title: chart?.title ?? "Unknown title",
    artist: chart?.artist ?? "Unknown artist",
  };
}

export async function updateCatalog(catalog_url: string, catalog_path: string): Promise<void> {
  const response = await fetch(catalog_url);
  if (!response.ok) throw new Error(`Catalog download returned ${response.status}`);

  const temporary_path = `${catalog_path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary_path, Buffer.from(await response.arrayBuffer()));
    const catalog = new DatabaseSync(temporary_path, { readOnly: true });
    try {
      catalog.prepare("SELECT chart_md5, chart_index, difficulty, speed, dexterity, stamina, technical, mode FROM charts LIMIT 1").get();
    } finally {
      catalog.close();
    }
    await rename(temporary_path, catalog_path);
  } catch (reason) {
    await rm(temporary_path, { force: true });
    throw reason;
  }
}

export async function prepareCatalog(catalog_url: string, catalog_path: string): Promise<void> {
  try {
    await updateCatalog(catalog_url, catalog_path);
  } catch (reason) {
    try {
      await access(catalog_path);
      const catalog = new DatabaseSync(catalog_path, { readOnly: true });
      try {
        catalog.prepare("SELECT chart_md5, chart_index, difficulty, speed, dexterity, stamina, technical, mode FROM charts LIMIT 1").get();
      } finally {
        catalog.close();
      }
    } catch {
      throw reason;
    }
  }
}

export function openReplayDatabase(database_path: string): DatabaseSync {
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

function authenticatedUser(database: DatabaseSync, request: IncomingMessage): UserRow | null {
  const match = request.headers.authorization?.match(/^Bearer (\S+)$/);
  if (!match) return null;
  return database.prepare(`
    SELECT users.id, users.name
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash(match[1]), Math.floor(Date.now() / 1000)) as unknown as UserRow | undefined ?? null;
}

function createSession(database: DatabaseSync, user_id: number): string {
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

export function createReplayServer({ database_path = "scores.sqlite", database: supplied_database,
  catalog_path, catalog: supplied_catalog, app_html, asset_base_url }: ReplayServerOptions = {}) {
  const database = supplied_database ?? openReplayDatabase(database_path);
  const catalog = supplied_catalog ?? (catalog_path ? new DatabaseSync(catalog_path, { readOnly: true }) : undefined);
  if (!catalog) {
    if (!supplied_database) database.close();
    throw new Error("Replay server requires a chart catalog");
  }
  const owns_database = !supplied_database;
  const owns_catalog = !supplied_catalog;

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
      const chart_page_match = request.method === "GET" && url.pathname.match(/^\/chart\/([a-f\d]{32})\/(\d+)\/?$/i);
      if (chart_page_match) {
        const chart = catalogChart(catalog, chart_page_match[1], Number(chart_page_match[2]));
        if (!app_html) {
          response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" }).end("Web client is unavailable");
          return;
        }
        const forwarded_proto = request.headers["x-forwarded-proto"];
        const protocol = forwarded_proto === "http" || forwarded_proto === "https" ? forwarded_proto : "https";
        const forwarded_host = request.headers["x-forwarded-host"];
        const host = typeof forwarded_host === "string" ? forwarded_host : request.headers.host ?? "rizu.kuudere.fun";
        const page_url = `${protocol}://${host}${url.pathname}`;
        const image_url = chart?.background_preview_path && asset_base_url
          ? new URL(chart.background_preview_path, asset_base_url).href
          : null;
        const body = chart ? chartPageHtml(app_html, chart, page_url, image_url) : app_html;
        response.writeHead(200, {
          "Cache-Control": "public, max-age=300",
          "Content-Length": Buffer.byteLength(body),
          "Content-Type": "text/html; charset=utf-8",
        }).end(body);
        return;
      }

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
        const user = database.prepare("SELECT id, name, password_hash FROM users WHERE name = ? COLLATE NOCASE")
          .get(name) as unknown as LoginRow | undefined;
        if (!user || !passwordMatches(password, user.password_hash)) {
          json(response, 401, { error: "Invalid name or password" });
          return;
        }
        json(response, 200, { user: { id: user.id, name: user.name }, token: createSession(database, user.id) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/me") {
        json(response, 200, { user: authenticatedUser(database, request) });
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
        if (typeof payload.chart_md5 !== "string" || !/^[a-f\d]{32}$/i.test(payload.chart_md5) ||
          !Number.isInteger(payload.chart_index) || typeof payload.chart_index !== "number" || payload.chart_index < 1 ||
          (payload.mode !== "mania" && payload.mode !== "osu") || typeof payload.replay !== "string") {
          json(response, 400, { error: "Score requires chart_md5, chart_index, mode, and Base64 replay" });
          return;
        }
        const replay = Buffer.from(payload.replay, "base64");
        const chart = catalogChart(catalog, payload.chart_md5, payload.chart_index);
        if (!chart) {
          json(response, 404, { error: "Chart is not in the catalog" });
          return;
        }
        const expected_mode = chart.mode === 0 ? "osu" : chart.mode === 3 ? "mania" : null;
        if (payload.mode !== expected_mode) {
          json(response, 400, { error: "Score mode does not match the catalog chart" });
          return;
        }
        const user = authenticatedUser(database, request);
        const played_at = typeof payload.played_at === "string" ? payload.played_at : new Date().toISOString();
        const submitted_at = new Date().toISOString();
        const metadata = { ...payload };
        delete metadata.replay;
        delete metadata.nickname;
        delete metadata.difficulty;
        delete metadata.pp;
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
        `).all(chart_md5.toLowerCase(), chart_index) as unknown as ScoreRow[];
        const ranked_users = new Set<number>();
        const rows = ranked_rows.filter((row) => {
          if (row.user_id === null) return true;
          if (ranked_users.has(row.user_id)) return false;
          ranked_users.add(row.user_id);
          return true;
        }).slice(0, boundedLimit(url.searchParams.get("limit")));
        json(response, 200, { scores: rows.map((row) => scoreFromRow(row, catalog)) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/rankings") {
        json(response, 200, { leaderboards: skillLeaderboards(database, catalog) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/scores/recent") {
        const rows = database.prepare(`${SCORE_SELECT} ORDER BY scores.id DESC LIMIT ?`)
          .all(boundedLimit(url.searchParams.get("limit"))) as unknown as ScoreRow[];
        json(response, 200, { scores: rows.map((row) => scoreFromRow(row, catalog)) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/scores/stats") {
        const counts = database.prepare(`
          SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE DATE(submitted_at) = DATE('now')) AS today
          FROM scores
        `).get() as { total: number; today: number };
        json(response, 200, counts);
        return;
      }

      const replay_match = request.method === "GET" && url.pathname.match(/^\/api\/scores\/(\d+)\/replay$/);
      if (replay_match) {
        const row = database.prepare("SELECT replay FROM scores WHERE id = ?")
          .get(Number(replay_match[1])) as unknown as ReplayRow | undefined;
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
      const message = reason instanceof Error ? reason.message : String(reason);
      json(response, status, { error: status === 500 ? "Internal server error" : message });
    }
  });
  server.on("close", () => {
    if (owns_database) database.close();
    if (owns_catalog) catalog.close();
  });
  return server;
}

const is_main = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
async function main(): Promise<void> {
  const database_path = process.env.RIZU_DATABASE ?? process.argv[2] ?? "scores.sqlite";
  const port = Number(process.env.PORT ?? process.argv[3] ?? 8765);
  const host = process.env.HOST ?? "127.0.0.1";
  const catalog_url = process.env.RIZU_CATALOG_URL ?? DEFAULT_CATALOG_URL;
  const catalog_path = process.env.RIZU_CATALOG ?? DEFAULT_CATALOG_PATH;
  const app_html_path = process.env.RIZU_WEB_INDEX ?? "/srv/rizu/dist/index.html";
  await prepareCatalog(catalog_url, catalog_path);
  const app_html = await readFile(app_html_path, "utf8");
  createReplayServer({ database_path, catalog_path, app_html, asset_base_url: new URL(".", catalog_url).href }).listen(port, host, () => {
    console.log(`Rizu API listening on http://${host}:${port}`);
  });
}

if (is_main) void main().catch((reason: unknown) => {
  console.error(reason);
  process.exitCode = 1;
});
