import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { openReplayDatabase, createReplayServer } from "./replay-server.mjs";

let database;
let server;
let base_url;

beforeEach(async () => {
  database = openReplayDatabase(":memory:");
  server = createReplayServer({ database });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base_url = `http://127.0.0.1:${server.address().port}/api`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  database.close();
});

async function request(path, options = {}) {
  const response = await fetch(`${base_url}${path}`, options);
  const result = await response.json();
  return { response, result };
}

async function auth(path, name, password = "secret1") {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
}

async function submit({ token, accuracy, score = 0,
  chart_md5 = "11111111111111111111111111111111", chart_index = 1, mode = "mania" }) {
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
  await submit({ token: registration.token, accuracy: 0.95, score: 950, mode: "osu" });
  await submit({ accuracy: 0.9, score: 900 });
  await submit({ accuracy: 0.7, score: 700 });

  const { result } = await request("/leaderboard?chart_md5=11111111111111111111111111111111&chart_index=1");
  assert.deepEqual(result.scores.map((play) => [play.nickname, play.accuracy, play.registered]), [
    ["Player", 0.95, true],
    ["Anonymous", 0.9, false],
    ["Anonymous", 0.7, false],
  ]);
});

test("lists recent plays newest first without deduplicating users", async () => {
  const { result: registration } = await auth("/register", "Player");
  await submit({ token: registration.token, accuracy: 0.8 });
  await submit({ accuracy: 0.9, chart_md5: "22222222222222222222222222222222" });

  const { result } = await request("/scores/recent?limit=2");
  assert.deepEqual(result.scores.map((play) => [play.chart_md5, play.chart_index, play.nickname]), [
    ["22222222222222222222222222222222", 1, "Anonymous"],
    ["11111111111111111111111111111111", 1, "Player"],
  ]);
});
