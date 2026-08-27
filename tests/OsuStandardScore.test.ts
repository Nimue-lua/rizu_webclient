import assert from "node:assert/strict";
import test from "node:test";
import type { OsuStandardJudgmentEvent } from "../src/gameplay/osu/OsuStandardJudgmentEvent";
import { ScoreEngine } from "../src/gameplay/scoring/ScoreEngine";
import { calculateOsuStandardDifficultyMultiplier } from "../src/gameplay/osu/scoring/OsuStandardDifficulty";
import { OsuStandardScore } from "../src/gameplay/osu/scoring/OsuStandardScore";
import { createOsuStandardTimingValues } from "../src/gameplay/osu/timing/OsuStandardOdTimings";

function hit(delta_time: number, object_index = 0): OsuStandardJudgmentEvent {
  return { kind: "hit", object_index, time: 1 + delta_time, delta_time };
}

function miss(object_index = 0): OsuStandardJudgmentEvent {
  return { kind: "miss", object_index, time: 1.2 };
}

test("classifies stable osu standard boundaries only inside the score system", () => {
  const engine = new ScoreEngine([new OsuStandardScore(createOsuStandardTimingValues(5), 1)]);
  for (const event of [hit(0.049), hit(0.05), hit(-0.099), hit(0.1), hit(-0.149), hit(0.15), miss()]) {
    engine.receive(event);
  }
  assert.deepEqual(engine.getResult().judges, { "300": 1, "100": 2, "50": 2, miss: 2 });
  assert.equal(engine.getResult().last_judge, "miss");
});

test("applies stable circle ScoreV1 combo bonus before incrementing combo", () => {
  const engine = new ScoreEngine([new OsuStandardScore(createOsuStandardTimingValues(5), 2)]);
  engine.receive(hit(0));
  engine.receive(hit(0.06));
  engine.receive(hit(0.12));
  assert.equal(engine.getResult().score, 454);
  assert.equal(engine.getResult().combo, 3);
  assert.equal(engine.getResult().max_combo, 3);

  engine.receive(miss());
  engine.receive(hit(0));
  assert.equal(engine.getResult().score, 754);
  assert.equal(engine.getResult().combo, 1);
  assert.equal(engine.getResult().max_combo, 3);
  assert.equal(engine.getResult().accuracy, 750 / 1500);
});

test("uses stable osu standard grades", () => {
  const perfect = new OsuStandardScore(createOsuStandardTimingValues(5), 1);
  perfect.receive(hit(0));
  assert.equal(perfect.getGrade(), "X");

  const s_rank = new OsuStandardScore(createOsuStandardTimingValues(5), 1);
  for (let index = 0; index < 91; index += 1) s_rank.receive(hit(0, index));
  for (let index = 91; index < 100; index += 1) s_rank.receive(hit(0.06, index));
  assert.equal(s_rank.getGrade(), "S");

  const missed = new OsuStandardScore(createOsuStandardTimingValues(5), 1);
  for (let index = 0; index < 91; index += 1) missed.receive(hit(0, index));
  for (let index = 91; index < 100; index += 1) missed.receive(miss(index));
  assert.equal(missed.getGrade(), "A");
});

test("calculates stable no-mod difficulty multiplier with midpoint-to-even rounding", () => {
  assert.equal(calculateOsuStandardDifficultyMultiplier(5, 5, 5, 100, 100), 3);
  assert.equal(calculateOsuStandardDifficultyMultiplier(0, 0, 0, 0, 1), 0);
  assert.equal(calculateOsuStandardDifficultyMultiplier(10, 10, 10, 100, 1), 6);
});

test("score judgment windows remain in chart-time units at changed music rates", () => {
  const windows = createOsuStandardTimingValues(5);
  const normal = new OsuStandardScore(windows, 1);
  const double_time = new OsuStandardScore(windows, 1);
  normal.receive(hit(0.049));
  // AudioGameplayClock already advances chart time at the playback rate, so the
  // score system receives the same chart-time delta and does not scale windows.
  double_time.receive(hit(0.049));
  assert.deepEqual(normal.getJudges(), double_time.getJudges());
});

test("scores stable slider parts and derives one accuracy judgment at the tail", () => {
  const score = new OsuStandardScore(createOsuStandardTimingValues(5), 1);
  score.receive({ kind: "slider-head", object_index: 0, time: 1, delta_time: 0, successful: true });
  score.receive({ kind: "slider-point", point_kind: "tick", object_index: 0, time: 1.5, successful: true });
  score.receive({ kind: "slider-point", point_kind: "repeat", object_index: 0, time: 2, successful: false });
  score.receive({ kind: "slider-point", point_kind: "tail", object_index: 0, time: 2.964, successful: true });
  score.receive({ kind: "slider-end", object_index: 0, time: 3, successful_parts: 3, total_parts: 4 });
  assert.deepEqual(score.getJudges(), [0, 1, 0, 0]);
  assert.equal(score.getScore(), 170);
  assert.equal(score.getCombo(), 1);
  assert.equal(score.getMaxCombo(), 2);
});
