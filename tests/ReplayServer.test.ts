import assert from "node:assert/strict";
import test from "node:test";
import type { StoredPlay } from "../src/replay/ReplayStore";
import { listGlobalRankings, listOnlineScores, submitPlay } from "../src/replay/ReplayServer";

test("submits score metadata and compressed replay bytes", async () => {
  const play: StoredPlay = {
    chart_id: "chart:42",
    mode: "mania",
    played_at: "2026-08-27T12:34:56.000Z",
    accuracy: 0.98,
    music_rate: 1.25,
    score: 123456,
    grade: "A",
    combo: 40,
    max_combo: 42,
    misses: 2,
    judges_json: "{\"perfect\":40,\"miss\":2}",
    last_judge: "perfect",
    replay_base_json: "{\"mode\":\"mania\",\"rate\":1.25}",
    replay_data: new Uint8Array([0, 1, 2, 255]),
  };
  let submitted_url = "";
  let submitted_init: RequestInit | undefined;

  await submitPlay(play, "  Nimue  ", async (input, init) => {
    submitted_url = String(input);
    submitted_init = init;
    return new Response(null, { status: 201 });
  });

  assert.equal(submitted_url, "/api/scores");
  assert.equal(submitted_init?.method, "POST");
  const payload = JSON.parse(String(submitted_init?.body));
  assert.equal(payload.nickname, "Nimue");
  assert.equal(payload.score, 123456);
  assert.deepEqual(payload.judges, { perfect: 40, miss: 2 });
  assert.equal(payload.replay, "AAEC/w==");
});

test("uses Anonymous for a blank nickname and rejects server errors", async () => {
  const play = {
    chart_id: "chart:42", mode: "osu", played_at: "now", accuracy: null, music_rate: 1,
    score: null, grade: null, combo: null, max_combo: null, misses: 0, judges_json: "{}",
    last_judge: null, replay_base_json: "{}", replay_data: new Uint8Array(),
  } satisfies StoredPlay;
  let nickname = "";

  await assert.rejects(
    submitPlay(play, "   ", async (_input, init) => {
      nickname = JSON.parse(String(init?.body)).nickname;
      return new Response(null, { status: 500 });
    }),
    /returned 500/,
  );
  assert.equal(nickname, "Anonymous");
});

test("loads a chart leaderboard", async () => {
  let requested_url = "";
  const scores = await listOnlineScores("chart:42", undefined, async (input) => {
    requested_url = String(input);
    return Response.json({ scores: [{ id: 1, nickname: "Nimue", accuracy: 0.99 }] });
  });

  assert.equal(requested_url, "/api/leaderboard?chart_id=chart%3A42&limit=5");
  assert.equal(scores[0]?.nickname, "Nimue");
});

test("loads global PP rankings", async () => {
  const players = await listGlobalRankings(undefined, async (input) => {
    assert.equal(String(input), "/api/rankings");
    return Response.json({ players: [{ rank: 1, nickname: "Nimue", pp: 123.45, play_count: 2 }] });
  });

  assert.equal(players[0]?.pp, 123.45);
});
