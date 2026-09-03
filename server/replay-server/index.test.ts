import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { openReplayDatabase, createReplayServer, skillRating } from "./index.ts";

interface ApiResult {
  [key: string]: any;
}

let database: DatabaseSync;
let catalog: DatabaseSync;
let server: Server;
let base_url: string;
let app_directory: string;

beforeEach(async () => {
  database = openReplayDatabase(":memory:");
  app_directory = await mkdtemp(path.join(os.tmpdir(), "rizu-server-test-"));
  await writeFile(path.join(app_directory, "app.js"), "export const ready = true;\n");
  catalog = new DatabaseSync(":memory:");
  catalog.exec(`
    CREATE TABLE songs (id TEXT PRIMARY KEY, title TEXT, artist TEXT);
    CREATE TABLE charts (chart_md5 TEXT, chart_index INTEGER, difficulty REAL, speed REAL, dexterity REAL,
      stamina REAL, technical REAL, mode INTEGER, keys INTEGER, name TEXT, background_preview_path TEXT, song_id TEXT);
    INSERT INTO songs VALUES ('song-1', 'First Song', 'First Artist');
    INSERT INTO songs VALUES ('song-2', 'Second Song', 'Second Artist');
    INSERT INTO charts VALUES ('11111111111111111111111111111111', 1, 5, 8, 2, 4, 1, 3, 4, 'Hard', 'backgrounds/v2/first.avif', 'song-1');
    INSERT INTO charts VALUES ('22222222222222222222222222222222', 1, 10, 3, 9, 5, 7, 3, 7, 'Challenge', NULL, 'song-2');
    INSERT INTO charts VALUES ('33333333333333333333333333333333', 1, 7, 2, 3, 4, 8, 0, NULL, 'Insane', NULL, 'song-1');
  `);
  server = createReplayServer({ database, catalog, app_html: "<!doctype html><html><head><title>Rizu</title></head><body></body></html>",
    app_directory, asset_base_url: "https://assets.example/" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base_url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  database.close();
  catalog.close();
  await rm(app_directory, { recursive: true, force: true });
});

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${base_url}${path}`, options);
  const result = await response.json() as ApiResult;
  return { response, result };
}

test("serves chart pages with catalog Open Graph metadata", async () => {
  const response = await fetch(`${base_url.replace(/\/api$/, "")}/chart/11111111111111111111111111111111/1`, {
    headers: { "X-Forwarded-Host": "rizu.example", "X-Forwarded-Proto": "https" },
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(body, /<title>First Artist - First Song \| Rizu<\/title>/);
  assert.match(body, /property="og:title" content="First Artist - First Song"/);
  assert.match(body, /property="og:description" content="Hard - 5\.00 difficulty"/);
  assert.match(body, /property="og:image" content="https:\/\/assets\.example\/backgrounds\/v2\/first\.avif"/);
  assert.match(body, /property="og:url" content="https:\/\/rizu\.example\/chart\/11111111111111111111111111111111\/1"/);
});

test("serves the web client without chart metadata for charts outside the server catalog", async () => {
  const response = await fetch(`${base_url.replace(/\/api$/, "")}/chart/99999999999999999999999999999999/1`);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /<title>Rizu<\/title>/);
  assert.doesNotMatch(body, /property="og:title"/);
});

test("serves modules with JavaScript MIME and never falls back for missing files", async () => {
  const origin = base_url.replace(/\/api$/, "");
  const module_response = await fetch(`${origin}/app.js`);
  assert.equal(module_response.status, 200);
  assert.equal(module_response.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(await module_response.text(), /ready = true/);

  const missing_response = await fetch(`${origin}/missing.js`);
  assert.equal(missing_response.status, 404);
  assert.equal(missing_response.headers.get("content-type"), "text/plain; charset=utf-8");
});

test("serves SPA HTML for application routes", async () => {
  const response = await fetch(`${base_url.replace(/\/api$/, "")}/settings`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(await response.text(), /<title>Rizu<\/title>/);
});

async function auth(path: string, name: string, password = "secret1") {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
}

interface Submission {
  token?: string;
  accuracy: number;
  score?: number;
  chart_md5?: string;
  chart_index?: number;
  mode?: "mania" | "osu";
}

async function submit({ token, accuracy, score = 0,
  chart_md5 = "11111111111111111111111111111111", chart_index = 1, mode = "mania" }: Submission) {
  const result = await request("/scores", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ chart_md5, chart_index, mode, accuracy, score,
      played_at: new Date().toISOString(), replay: "AAEC" }),
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.result));
  return result;
}

test("registers and logs in a case-insensitive user", async () => {
  const registration = await auth("/register", "Nimue");
  assert.equal(registration.response.status, 201);
  assert.equal(registration.result.user.name, "Nimue");
  assert.ok(registration.result.token);

  const duplicate = await auth("/register", "nimue");
  assert.equal(duplicate.response.status, 409);
  const login = await auth("/login", "NIMUE");
  assert.equal(login.response.status, 200);

  const me = await request("/me", { headers: { Authorization: `Bearer ${login.result.token}` } });
  assert.equal(me.result.user.name, "Nimue");
});

test("counts active clients and deduplicates logged-in users", async () => {
  const { result: registration } = await auth("/register", "OnlinePlayer");
  await submit({ token: registration.token, accuracy: 1 });
  const heartbeat = (client_id: string, token?: string) => request("/presence", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ client_id }),
  });

  const anonymous = await heartbeat("anonymous-client-1");
  assert.equal(anonymous.result.count, 1);
  assert.deepEqual(anonymous.result.players[0], {
    id: "anonymous:0", name: "Anonymous", speed: 0, stamina: 0, dexterity: 0, technical: 0, accuracy: null,
  });
  assert.equal((await heartbeat("anonymous-client-2")).result.count, 2);
  assert.equal((await heartbeat("registered-client-1", registration.token)).result.count, 3);
  const deduplicated = await heartbeat("registered-client-2", registration.token);
  assert.equal(deduplicated.result.count, 3);
  assert.deepEqual(deduplicated.result.players.find((player: ApiResult) => player.name === "OnlinePlayer"), {
    id: `user:${registration.user.id}`,
    name: "OnlinePlayer",
    speed: 0.5,
    stamina: 0.3,
    dexterity: 0.2,
    technical: 0.15,
    accuracy: 1,
  });

  database.prepare("UPDATE presence SET last_seen = 0 WHERE client_id = ?").run("anonymous-client-1");
  assert.equal((await heartbeat("registered-client-1", registration.token)).result.count, 2);
});

test("rejects invalid presence client IDs", async () => {
  const { response } = await request("/presence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: "short" }),
  });
  assert.equal(response.status, 400);
});

test("interpolates score skill rating through the accuracy curve", () => {
  const closeTo = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12);
  closeTo(skillRating(8, 1), 10);
  closeTo(skillRating(8, 0.975), 9);
  closeTo(skillRating(8, 0.95), 8);
  closeTo(skillRating(8, 0.925), 6);
  closeTo(skillRating(8, 0.9), 4);
  closeTo(skillRating(8, 0.85), 2);
  closeTo(skillRating(8, 0.8), 0);
  closeTo(skillRating(8, 0.7), 0);
});

test("shows only a registered user's best chart score and every anonymous score", async () => {
  const { result: registration } = await auth("/register", "Player");
  await submit({ token: registration.token, accuracy: 0.8, score: 800 });
  await submit({ token: registration.token, accuracy: 0.95, score: 950 });
  await submit({ accuracy: 0.9, score: 900 });
  await submit({ accuracy: 0.7, score: 700 });

  const { result } = await request("/leaderboard?chart_md5=11111111111111111111111111111111&chart_index=1");
  assert.deepEqual(result.scores.map((play: ApiResult) => [play.nickname, play.accuracy, play.registered]), [
    ["Player", 0.95, true],
    ["Anonymous", 0.9, false],
    ["Anonymous", 0.7, false],
  ]);
  assert.equal(result.scores[0].difficulty, 5);
  assert.equal(result.scores[0].max_skill_difficulty, 8);
  assert.equal(result.scores[0].pp, undefined);
});

test("lets registered users comment on their own scores", async () => {
  const { result: owner } = await auth("/register", "Owner");
  const { result: stranger } = await auth("/register", "Stranger");
  const { result: submission } = await submit({ token: owner.token, accuracy: 0.95 });

  const unauthenticated = await request(`/scores/${submission.id}/comment`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment: "nope" }),
  });
  assert.equal(unauthenticated.response.status, 401);
  const forbidden = await request(`/scores/${submission.id}/comment`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${stranger.token}` },
    body: JSON.stringify({ comment: "also nope" }),
  });
  assert.equal(forbidden.response.status, 404);
  const updated = await request(`/scores/${submission.id}/comment`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
    body: JSON.stringify({ comment: "  almost FC  " }),
  });
  assert.deepEqual(updated.result, { comment: "almost FC" });

  const { result: leaderboard } = await request("/leaderboard?chart_md5=11111111111111111111111111111111&chart_index=1");
  assert.equal(leaderboard.scores[0].comment, "almost FC");
});

test("rejects score comments longer than 160 characters", async () => {
  const { result: owner } = await auth("/register", "Owner");
  const { result: submission } = await submit({ token: owner.token, accuracy: 0.95 });
  const result = await request(`/scores/${submission.id}/comment`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
    body: JSON.stringify({ comment: "x".repeat(161) }),
  });
  assert.equal(result.response.status, 400);
});

test("lists recent plays newest first without deduplicating users", async () => {
  const { result: registration } = await auth("/register", "Player");
  await submit({ token: registration.token, accuracy: 0.8 });
  await submit({ accuracy: 0.9, chart_md5: "22222222222222222222222222222222" });

  const { result } = await request("/scores/recent?limit=2");
  assert.deepEqual(result.scores.map((play: ApiResult) => [play.chart_md5, play.chart_index, play.nickname]), [
    ["22222222222222222222222222222222", 1, "Anonymous"],
    ["11111111111111111111111111111111", 1, "Player"],
  ]);
  assert.equal(result.scores[0].difficulty, 10);
  assert.equal(result.scores[0].max_skill_difficulty, 9);
  assert.equal(result.scores[0].artist, "Second Artist");
  assert.equal(result.scores[0].title, "Second Song");
  assert.equal(result.scores[0].keys, 7);
  assert.equal(result.scores[0].chart_name, "Challenge");
  assert.equal(result.scores[0].pp, undefined);
});

test("counts all scores and scores submitted today", async () => {
  await submit({ accuracy: 0.8 });
  await submit({ accuracy: 0.9 });
  database.prepare("UPDATE scores SET submitted_at = '2020-01-01T00:00:00.000Z' WHERE id = 1").run();

  const { result } = await request("/scores/stats");
  assert.deepEqual(result, { total: 2, today: 1 });
});

test("builds each skill leaderboard from its own top 20 chart scores", async () => {
  const { result: first } = await auth("/register", "SpeedPlayer");
  const { result: second } = await auth("/register", "DexPlayer");
  await submit({ token: first.token, accuracy: 1 });
  await submit({ token: first.token, accuracy: 0.5, chart_md5: "22222222222222222222222222222222" });
  await submit({ token: first.token, accuracy: 0.9 });
  await submit({ token: second.token, accuracy: 1, chart_md5: "22222222222222222222222222222222" });
  await submit({ accuracy: 1 });

  const { result } = await request("/rankings");
  assert.deepEqual(result.leaderboards.speed.map((player: ApiResult) => [player.rank, player.nickname, player.rating, player.play_count]), [
    [1, "SpeedPlayer", 0.5, 2],
    [2, "DexPlayer", 0.25, 1],
  ]);
  assert.deepEqual(result.leaderboards.dexterity.map((player: ApiResult) => [player.rank, player.nickname, player.rating, player.play_count]), [
    [1, "DexPlayer", 0.55, 1],
    [2, "SpeedPlayer", 0.2, 2],
  ]);
  assert.equal(result.leaderboards.stamina[0].nickname, "DexPlayer");
  assert.equal(result.leaderboards.technical[0].nickname, "DexPlayer");
});

test("rejects scores for unknown charts and mismatched modes", async () => {
  const unknown = await request("/scores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chart_md5: "99999999999999999999999999999999", chart_index: 1,
      mode: "mania", accuracy: 1, replay: "AAEC",
    }),
  });
  assert.equal(unknown.response.status, 404);

  const wrong_mode = await request("/scores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chart_md5: "33333333333333333333333333333333", chart_index: 1,
      mode: "mania", accuracy: 1, replay: "AAEC",
    }),
  });
  assert.equal(wrong_mode.response.status, 400);

  const count = database.prepare("SELECT count(*) AS count FROM scores").get() as { count: number };
  assert.equal(count.count, 0);
});
