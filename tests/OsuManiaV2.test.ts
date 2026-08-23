import assert from "node:assert/strict";
import test from "node:test";
import { NoteState } from "../src/gameplay/LogicEvent";
import { ScoreEngine } from "../src/gameplay/scoring/ScoreEngine";
import { OsuManiaV2Score } from "../src/gameplay/scoring/systems/OsuManiaV2Score";
import { createOsuManiaV2TimingValues } from "../src/gameplay/timing/OsuManiaV2Timings";
import { classifyTiming } from "../src/gameplay/timing/TimingValues";

test("creates rounded osu mania v2 logic windows", () => {
  const timings = createOsuManiaV2TimingValues(7.5);
  assert.deepEqual(timings.short_note, { hit: [-0.129, 0.105], miss: [-0.166, 0.105] });
  assert.deepEqual(timings.long_note_end, { hit: [-0.193, 0.157], miss: [-0.249, 0.157] });
});

test("classifies timing boundaries inclusively", () => {
  const window = createOsuManiaV2TimingValues(5).short_note;
  assert.equal(classifyTiming(window, -0.173), "early");
  assert.equal(classifyTiming(window, -0.136), "exactly");
  assert.equal(classifyTiming(window, 0.112), "exactly");
  assert.equal(classifyTiming(window, 0.112001), "too late");
});

test("scores release deltas after tail normalization", () => {
  const score = new ScoreEngine([new OsuManiaV2Score(5)]);
  score.receive({ index: 0, type: "tap", time: 0, delta_time: 0.03,
    old_state: NoteState.Clear, new_state: NoteState.Passed });
  score.receive({ index: 1, type: "hold", time: 0, delta_time: 0.06,
    old_state: NoteState.StartPassedPressed, new_state: NoteState.EndPassed });
  score.receive({ index: 2, type: "tap", time: 0, delta_time: 0,
    old_state: NoteState.Clear, new_state: NoteState.Missed });
  assert.deepEqual(score.getResult().judges, {
    perfect: 0,
    great: 2,
    good: 0,
    ok: 0,
    meh: 0,
    miss: 1,
  });
  assert.ok(Math.abs(score.getResult().accuracy! - 600 / 915) < 1e-12);
});

test("exposes only capabilities implemented by selected systems", () => {
  const result = new ScoreEngine([new OsuManiaV2Score(5)]).getResult();
  assert.equal(result.accuracy, 0);
  assert.deepEqual(result.judge_names, ["perfect", "great", "good", "ok", "meh", "miss"]);
  assert.equal(result.score, undefined);
  assert.equal(result.combo, undefined);
});
