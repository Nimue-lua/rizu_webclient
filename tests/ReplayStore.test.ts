import assert from "node:assert/strict";
import test from "node:test";
import { replayTick, replayValue, type CompletedGameplay } from "../src/replay/RecordedReplay";
import { completedGameplayFromStoredPlay, storedPlay } from "../src/replay/ReplayStore";
import { createOsuReplayBase } from "../src/replay/osu/OsuReplayBase";

test("quantizes replay values to integer 1/8192 ticks", () => {
  assert.equal(replayTick(1), 8192);
  assert.equal(replayTick(-0.001), -8);
  assert.equal(replayTick(12.3456), 101135);
  assert.equal(replayValue(8192), 1);
});

test("builds a searchable stored play with compressed binary replay data", () => {
  const completed: CompletedGameplay = {
    score: { score: 123456, accuracy: 0.9875, grade: "A", combo: 4, max_combo: 42,
      judges: { "300": 40, "100": 2, "50": 1, miss: 3 }, judge_names: ["300", "100", "50", "miss"], last_judge: "300" },
    replay_base: createOsuReplayBase(1.25, 7),
    replay: {
      version: 1,
      mode: "osu",
      time_unit: "1/8192 second",
      input_events: [{ type: "action", time: 8192, action: "primary", pressed: true }],
      judgment_events: [],
    },
  };

  const play = storedPlay("chart:42", completed, new Date("2026-08-27T12:34:56.000Z"));

  assert.equal(play.chart_id, "chart:42");
  assert.equal(play.accuracy, 0.9875);
  assert.equal(play.music_rate, 1.25);
  assert.equal(play.played_at, "2026-08-27T12:34:56.000Z");
  assert.equal(play.misses, 3);
  assert.equal(play.max_combo, 42);
  assert.deepEqual(JSON.parse(play.judges_json), completed.score.judges);
  assert.deepEqual(JSON.parse(play.replay_base_json), completed.replay_base);
  assert.ok(play.replay_data instanceof Uint8Array);
  assert.ok(play.replay_data.byteLength < JSON.stringify(completed.replay).length);
  assert.deepEqual(completedGameplayFromStoredPlay(play), completed);
});

test("rejects stored plays whose replay modes disagree", () => {
  const completed: CompletedGameplay = {
    score: { accuracy: 1, grade: "X" },
    replay_base: createOsuReplayBase(),
    replay: { version: 1, mode: "osu", time_unit: "1/8192 second", input_events: [], judgment_events: [] },
  };
  const play = { ...storedPlay("chart:42", completed), mode: "mania" as const };
  assert.throws(() => completedGameplayFromStoredPlay(play), /modes do not match/);
});

test("stores zero when gameplay has no score source", () => {
  const completed: CompletedGameplay = {
    score: { accuracy: 0.95, grade: "A" },
    replay_base: createOsuReplayBase(),
    replay: { version: 1, mode: "osu", time_unit: "1/8192 second", input_events: [], judgment_events: [] },
  };

  assert.equal(storedPlay("chart:42", completed).score, 0);
});
