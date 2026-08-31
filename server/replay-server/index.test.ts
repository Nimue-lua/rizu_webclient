import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, test } from "node:test";
import { openReplayDatabase, createReplayServer, playPp } from "./index.ts";

interface ApiResult {
  [key: string]: any;
}

let database: DatabaseSync;
let catalog: DatabaseSync;
let server: Server;
let base_url: string;

beforeEach(async () => {
  database = openReplayDatabase(":memory:");
  catalog = new DatabaseSync(":memory:");
  catalog.exec(`
    CREATE TABLE songs (id TEXT PRIMARY KEY, title TEXT, artist TEXT);
    CREATE TABLE charts (chart_md5 TEXT, chart_index INTEGER, difficulty REAL, mode INTEGER, keys INTEGER, name TEXT, song_id TEXT);
    INSERT INTO songs VALUES ('song-1', 'First Song', 'First Artist');
    INSERT INTO songs VALUES ('song-2', 'Second Song', 'Second Artist');
    INSERT INTO charts VALUES ('11111111111111111111111111111111', 1, 5, 3, 4, 'Hard', 'song-1');
    INSERT INTO charts VALUES ('22222222222222222222222222222222', 1, 10, 3, 7, 'Challenge', 'song-2');
    INSERT INTO charts VALUES ('33333333333333333333333333333333', 1, 7, 0, NULL, 'Insane', 'song-1');
  `);
  server = createReplayServer({ database, catalog });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base_url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  database.close();
  catalog.close();
});

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${base_url}${path}`, options);
  const result = await response.json() as ApiResult;
  return { response, result };
}

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
  assert.equal(result.scores[0].pp, playPp(5, 0.95));
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
  assert.equal(result.scores[0].artist, "Second Artist");
  assert.equal(result.scores[0].title, "Second Song");
  assert.equal(result.scores[0].keys, 7);
  assert.equal(result.scores[0].chart_name, "Challenge");
  assert.equal(result.scores[0].pp, playPp(10, 0.9));
});

test("counts all scores and scores submitted today", async () => {
  await submit({ accuracy: 0.8 });
  await submit({ accuracy: 0.9 });
  database.prepare("UPDATE scores SET submitted_at = '2020-01-01T00:00:00.000Z' WHERE id = 1").run();

  const { result } = await request("/scores/stats");
  assert.deepEqual(result, { total: 2, today: 1 });
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
