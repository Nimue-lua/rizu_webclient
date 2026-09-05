#!/usr/bin/env node
import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticatedUser, createSession, credentials, passwordHash, passwordMatches, tokenHash } from "./auth.ts";
import { catalogChart } from "./catalog.ts";
import { dashboardHtml } from "./dashboard.ts";
import { openReplayDatabase } from "./database.ts";
import { listLeaderboards, playerSummary, rebuildCaches, scoreLeaderboard } from "./rankings.ts";
import { processValidationJobs, requeueOutdatedValidationJobs } from "./replay-validation.ts";
import { ChartStore } from "./chart-store.ts";
import { createReplayValidator, REPLAY_COMPUTE_VERSION } from "./replay-verifier.ts";
import type { CatalogChartRow, JsonObject, LoginRow, ReplayServerOptions, ScoreRow } from "./types.ts";

export { openReplayDatabase };

const MAX_BODY_SIZE = 5 * 1024 * 1024;
const MAX_COMMENT_LENGTH = 160;
const MAX_RESULTS = 50;
const PRESENCE_LIFETIME_SECONDS = 90;
const DEFAULT_CATALOG_URL = "https://s3.kuudere.fun/catalog.sqlite";
const DEFAULT_CATALOG_PATH = "server/replay-server/catalog.sqlite";
const DEFAULT_WEB_ROOT = fileURLToPath(new URL("../../dist", import.meta.url));

interface ReplayRow {
  replay: Uint8Array;
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

const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".osk": "application/octet-stream",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

async function staticFile(app_directory: string, pathname: string): Promise<{ body: Buffer; content_type: string } | null> {
  let decoded_path: string;
  try {
    decoded_path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative_path = decoded_path.replace(/^\/+/, "");
  const file_path = path.resolve(app_directory, relative_path);
  if (file_path !== app_directory && !file_path.startsWith(`${app_directory}${path.sep}`)) return null;
  try {
    const body = await readFile(file_path);
    return { body, content_type: STATIC_CONTENT_TYPES[path.extname(file_path).toLowerCase()] ?? "application/octet-stream" };
  } catch (reason) {
    if (reason && typeof reason === "object" && "code" in reason && (reason.code === "ENOENT" || reason.code === "EISDIR")) return null;
    throw reason;
  }
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


function scoreFromRow(row: ScoreRow, catalog: DatabaseSync): JsonObject {
  const metadata = JSON.parse(row.metadata_json) as JsonObject;
  const chart = typeof metadata.chart_md5 === "string" && typeof metadata.chart_index === "number"
    ? catalogChart(catalog, metadata.chart_md5, metadata.chart_index)
    : undefined;
  const max_skill_difficulty = Math.max(0, chart?.speed ?? 0, chart?.dexterity ?? 0,
    chart?.stamina ?? 0, chart?.technical ?? 0);
  return {
    ...metadata,
    id: row.id,
    score: row.score,
    accuracy: row.accuracy,
    validation_state: row.validation_state,
    comment: row.comment,
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

const SCORE_SELECT = `
  SELECT scores.*, users.name AS user_name
  FROM scores LEFT JOIN users ON users.id = scores.user_id
`;

export function createReplayServer({ database_path = "scores.sqlite", database: supplied_database,
  catalog_path, catalog: supplied_catalog, app_html, app_directory, asset_base_url, replay_validator }: ReplayServerOptions = {}) {
  const database = supplied_database ?? openReplayDatabase(database_path);
  const catalog = supplied_catalog ?? (catalog_path ? new DatabaseSync(catalog_path, { readOnly: true }) : undefined);
  if (!catalog) {
    if (!supplied_database) database.close();
    throw new Error("Replay server requires a chart catalog");
  }
  const owns_database = !supplied_database;
  const owns_catalog = !supplied_catalog;
  rebuildCaches(database, catalog);
  if (replay_validator) requeueOutdatedValidationJobs(database);
  let validation_running = false;
  const runValidation = async () => {
    if (!replay_validator || validation_running) return;
    validation_running = true;
    try {
      await processValidationJobs(database, catalog, replay_validator, 25);
    } catch (reason) {
      console.error("Replay validation worker failed", reason);
    } finally {
      validation_running = false;
    }
  };
  const validation_timer = replay_validator ? setInterval(() => void runValidation(), 1_000) : undefined;
  validation_timer?.unref();
  void runValidation();

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
      if (request.method === "GET" && (url.pathname === "/server" || url.pathname === "/server/")) {
        const body = dashboardHtml(database);
        response.writeHead(200, { "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body),
          "Content-Type": "text/html; charset=utf-8" }).end(body);
        return;
      }
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
            .run(name, await passwordHash(password), new Date().toISOString());
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
        if (!user || !await passwordMatches(password, user.password_hash)) {
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

      if (request.method === "POST" && url.pathname === "/api/presence") {
        const payload = await readJson(request);
        if (typeof payload.client_id !== "string" || !/^[a-z\d_-]{16,128}$/i.test(payload.client_id)) {
          json(response, 400, { error: "Presence requires a valid client_id" });
          return;
        }
        const now = Math.floor(Date.now() / 1000);
        const user = authenticatedUser(database, request);
        database.prepare("DELETE FROM presence WHERE last_seen < ?").run(now - PRESENCE_LIFETIME_SECONDS);
        database.prepare(`
          INSERT INTO presence (client_id, user_id, last_seen) VALUES (?, ?, ?)
          ON CONFLICT(client_id) DO UPDATE SET user_id = excluded.user_id, last_seen = excluded.last_seen
        `).run(payload.client_id, user?.id ?? null, now);
        const count = database.prepare(`
          SELECT COUNT(DISTINCT CASE WHEN user_id IS NULL THEN 'client:' || client_id ELSE 'user:' || user_id END) AS count
          FROM presence WHERE last_seen >= ?
        `).get(now - PRESENCE_LIFETIME_SECONDS) as { count: number };
        const active_rows = database.prepare(`
          SELECT presence.client_id, presence.user_id, users.name
          FROM presence LEFT JOIN users ON users.id = presence.user_id
          WHERE presence.last_seen >= ?
          ORDER BY presence.user_id IS NULL, users.name COLLATE NOCASE, presence.client_id
        `).all(now - PRESENCE_LIFETIME_SECONDS) as unknown as {
          client_id: string; user_id: number | null; name: string | null;
        }[];
        const seen_users = new Set<number>();
        let anonymous_index = 0;
        const players = active_rows.flatMap((row) => {
          if (row.user_id !== null && seen_users.has(row.user_id)) return [];
          if (row.user_id !== null) seen_users.add(row.user_id);
          const ratings = row.user_id === null ? undefined : playerSummary(database, row.user_id);
          return [{
            id: row.user_id === null ? `anonymous:${anonymous_index++}` : `user:${row.user_id}`,
            name: row.name ?? "Anonymous",
            total_score: Number(ratings?.total_score ?? 0),
            play_time_seconds: Number(ratings?.play_time_seconds ?? 0),
            score_count: Number(ratings?.score_count ?? 0),
            rank: row.user_id === null ? null : Number(ratings?.rank ?? 0) || null,
            accuracy: row.user_id === null ? null : Number(ratings?.accuracy ?? 0) || null,
          }];
        });
        json(response, 200, { count: count.count, players });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/scores") {
        const payload = await readJson(request);
        if (typeof payload.chart_md5 !== "string" || !/^[a-f\d]{32}$/i.test(payload.chart_md5) ||
          !Number.isInteger(payload.chart_index) || typeof payload.chart_index !== "number" || payload.chart_index < 1 ||
          (payload.mode !== "mania" && payload.mode !== "osu") || typeof payload.replay !== "string" ||
          typeof payload.replay_base !== "object" || payload.replay_base === null || Array.isArray(payload.replay_base)) {
          json(response, 400, { error: "Score requires chart_md5, chart_index, mode, replay_base, and Base64 replay" });
          return;
        }
        const replay = Buffer.from(payload.replay, "base64");
        const chart = catalogChart(catalog, payload.chart_md5, payload.chart_index);
        if (!chart) {
          json(response, 404, { error: "Chart is not in the catalog" });
          return;
        }
        if (replay.length === 0) {
          json(response, 400, { error: "Replay must not be empty" });
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
        const replay_base = payload.replay_base as JsonObject;
        const music_rate = typeof replay_base.rate === "number" && Number.isFinite(replay_base.rate) && replay_base.rate > 0
          ? replay_base.rate : 1;
        const duration_seconds = chart.duration_seconds / music_rate;
        const metadata = { chart_md5: payload.chart_md5.toLowerCase(), chart_index: payload.chart_index,
          mode: payload.mode, played_at, replay_base };
        database.exec("BEGIN IMMEDIATE");
        let score_id: number;
        try {
          const result = database.prepare(`
            INSERT INTO scores (chart_md5, chart_index, user_id, mode, accuracy, score, played_at,
              submitted_at, metadata_json, replay, duration_seconds, validation_state)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(payload.chart_md5.toLowerCase(), payload.chart_index, user?.id ?? null, payload.mode,
            null, null, played_at, submitted_at, JSON.stringify(metadata), replay, replay_validator ? 0 : duration_seconds,
            replay_validator ? "queued" : "unverified");
          score_id = Number(result.lastInsertRowid);
          database.prepare("UPDATE server_state SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'total_scores'").run();
          database.prepare(`INSERT INTO score_days (day, score_count) VALUES (DATE(?), 1)
            ON CONFLICT(day) DO UPDATE SET score_count = score_count + 1`).run(submitted_at);
          if (replay_validator) database.prepare("INSERT INTO validation_jobs (score_id, updated_at, compute_version) VALUES (?, ?, ?)")
            .run(score_id, submitted_at, REPLAY_COMPUTE_VERSION);
          database.exec("COMMIT");
        } catch (reason) {
          database.exec("ROLLBACK");
          throw reason;
        }
        void runValidation();
        json(response, 201, { id: score_id, submitted_at, validation_state: replay_validator ? "queued" : "unverified" });
        return;
      }

      const comment_match = request.method === "POST" && url.pathname.match(/^\/api\/scores\/(\d+)\/comment$/);
      if (comment_match) {
        const user = authenticatedUser(database, request);
        if (!user) {
          json(response, 401, { error: "Authentication required" });
          return;
        }
        const payload = await readJson(request);
        if (typeof payload.comment !== "string") {
          json(response, 400, { error: "Comment must be text" });
          return;
        }
        const comment = payload.comment.trim();
        if (comment.length > MAX_COMMENT_LENGTH) {
          json(response, 400, { error: `Comment must contain at most ${MAX_COMMENT_LENGTH} characters` });
          return;
        }
        const result = database.prepare("UPDATE scores SET comment = ? WHERE id = ? AND user_id = ?")
          .run(comment || null, Number(comment_match[1]), user.id);
        if (result.changes === 0) {
          json(response, 404, { error: "Score not found" });
          return;
        }
        json(response, 200, { comment: comment || null });
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
          WHERE scores.chart_md5 = ? AND scores.chart_index = ? AND scores.validation_state IN ('valid', 'unverified')
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
        const leaderboard = url.searchParams.get("leaderboard") ?? "all";
        const rankings = scoreLeaderboard(database, leaderboard);
        if (!rankings) json(response, 404, { error: "Leaderboard not found" });
        else json(response, 200, { leaderboard, available: listLeaderboards(database), rankings });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/scores/recent") {
        const rows = database.prepare(`${SCORE_SELECT} ORDER BY scores.id DESC LIMIT ?`)
          .all(boundedLimit(url.searchParams.get("limit"))) as unknown as ScoreRow[];
        json(response, 200, { scores: rows.map((row) => scoreFromRow(row, catalog)) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/scores/stats") {
        const counts = database.prepare(`SELECT CAST((SELECT value FROM server_state WHERE key = 'total_scores') AS INTEGER) AS total,
          COALESCE((SELECT score_count FROM score_days WHERE day = DATE('now')), 0) AS today`).get();
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

      if ((request.method === "GET" || request.method === "HEAD") && app_html && app_directory) {
        const file = url.pathname === "/" ? null : await staticFile(app_directory, url.pathname);
        if (file) {
          response.writeHead(200, {
            "Cache-Control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
            "Content-Length": file.body.length,
            "Content-Type": file.content_type,
          }).end(request.method === "HEAD" ? undefined : file.body);
          return;
        }
        if (path.posix.extname(url.pathname)) {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
          return;
        }
        response.writeHead(200, {
          "Cache-Control": "no-cache",
          "Content-Length": Buffer.byteLength(app_html),
          "Content-Type": "text/html; charset=utf-8",
        }).end(request.method === "HEAD" ? undefined : app_html);
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
    if (validation_timer) clearInterval(validation_timer);
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
  const app_directory = path.resolve(process.env.RIZU_WEB_ROOT ?? DEFAULT_WEB_ROOT);
  const chart_cache = process.env.RIZU_CHART_CACHE ?? path.join(path.dirname(database_path), "chart-cache");
  await prepareCatalog(catalog_url, catalog_path);
  const app_html = await readFile(path.join(app_directory, "index.html"), "utf8");
  const catalog = new DatabaseSync(catalog_path, { readOnly: true });
  const asset_base_url = new URL(".", catalog_url).href;
  const replay_validator = createReplayValidator(new ChartStore(catalog, { cache_directory: chart_cache, asset_base_url }));
  createReplayServer({ database_path, catalog, app_html, app_directory, asset_base_url, replay_validator }).listen(port, host, () => {
    console.log(`Rizu API listening on http://${host}:${port}`);
  });
}

if (is_main) void main().catch((reason: unknown) => {
  console.error(reason);
  process.exitCode = 1;
});
