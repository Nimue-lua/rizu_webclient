import assert from "node:assert/strict";
import test from "node:test";
import type { StoredPlay } from "../src/replay/ReplayStore";
import { listOnlineScores, listRecentPlays, listSkillLeaderboards, loadScoreStats, submitPlay } from "../src/replay/ReplayServer";

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

  await submitPlay(play, "0123456789abcdef0123456789abcdef", 2, async (input, init) => {
    submitted_url = String(input);
    submitted_init = init;
    return new Response(null, { status: 201 });
  });

  assert.equal(submitted_url, "/api/scores");
  assert.equal(submitted_init?.method, "POST");
  const payload = JSON.parse(String(submitted_init?.body));
  assert.equal(payload.nickname, undefined);
  assert.equal(payload.chart_md5, "0123456789abcdef0123456789abcdef");
  assert.equal(payload.chart_index, 2);
  assert.equal(payload.score, 123456);
  assert.deepEqual(payload.judges, { perfect: 40, miss: 2 });
  assert.equal(payload.replay, "AAEC/w==");
});

test("rejects score submission server errors", async () => {
  const play = {
    chart_id: "chart:42", mode: "osu", played_at: "now", accuracy: null, music_rate: 1,
    score: null, grade: null, combo: null, max_combo: null, misses: 0, judges_json: "{}",
    last_judge: null, replay_base_json: "{}", replay_data: new Uint8Array(),
  } satisfies StoredPlay;
  await assert.rejects(
    submitPlay(play, "0123456789abcdef0123456789abcdef", 1, async () => {
      return new Response(null, { status: 500 });
    }),
    /returned 500/,
  );
});

test("loads a chart leaderboard", async () => {
  let requested_url = "";
  const scores = await listOnlineScores("0123456789abcdef0123456789abcdef", 2, undefined, async (input) => {
    requested_url = String(input);
    return Response.json({ scores: [{ id: 1, nickname: "Nimue", accuracy: 0.99 }] });
  });

  assert.equal(requested_url, "/api/leaderboard?chart_md5=0123456789abcdef0123456789abcdef&chart_index=2&limit=5");
  assert.equal(scores[0]?.nickname, "Nimue");
});

test("loads recent plays", async () => {
  const scores = await listRecentPlays(undefined, async (input) => {
    assert.equal(String(input), "/api/scores/recent?limit=50");
    return Response.json({ scores: [{ id: 1, nickname: "Nimue", accuracy: 0.98 }] });
  });

  assert.equal(scores[0]?.nickname, "Nimue");
});

test("loads score statistics", async () => {
  const stats = await loadScoreStats(undefined, async (input) => {
    assert.equal(String(input), "/api/scores/stats");
    return Response.json({ total: 120, today: 7 });
  });

  assert.deepEqual(stats, { total: 120, today: 7 });
});

test("loads independently ranked skill leaderboards", async () => {
  const leaderboards = await listSkillLeaderboards(undefined, async (input, init) => {
    assert.equal(String(input), "/api/rankings");
    assert.equal(init?.cache, "no-store");
    return Response.json({ leaderboards: {
      speed: [{ rank: 1, nickname: "Fast", rating: 8 }],
      technical: [{ rank: 1, nickname: "Tech", rating: 7 }],
    } });
  });

  assert.equal(leaderboards.speed[0]?.nickname, "Fast");
  assert.equal(leaderboards.technical[0]?.nickname, "Tech");
  assert.deepEqual(leaderboards.dexterity, []);
  assert.deepEqual(leaderboards.stamina, []);
});
