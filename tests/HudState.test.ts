import assert from "node:assert/strict";
import test from "node:test";
import { HudStateDeriver } from "../src/gameplay/HudState";

test("derives immutable HUD snapshots from shared score results", () => {
  const deriver = new HudStateDeriver();
  const first = deriver.update({ score: 1234, combo: 12, accuracy: 0.985, last_judge: "perfect",
    judges: { perfect: 1 } }, 1);
  assert.deepEqual(first, {
    hud: { score: 0, accuracy: 0 },
    combo: 12,
    comboAnimationAge: 0,
    comboAnimationFrom: 0,
    judgment: "perfect",
    judgmentAge: 0,
    hitErrorMeter: { windows: null, ticks: [], floatingError: 0, age: Infinity },
  });
  const second = deriver.update({ score: 1234, combo: 12, accuracy: 0.985, last_judge: "perfect",
    judges: { perfect: 1 } }, 1.1);
  assert.ok(second.hud.score > 0 && second.hud.score < 1234);
  assert.ok(second.hud.accuracy > 0 && second.hud.accuracy < 98.5);
  assert.ok(second.judgmentAge > 0);
  assert.ok(Math.abs(second.comboAnimationAge - 0.1) < 1e-12);
  assert.notEqual(first, second);
});

test("restarts judgment age when identical judgments increase the count", () => {
  const deriver = new HudStateDeriver();
  deriver.update({ last_judge: "perfect", judges: { perfect: 1 } }, 1);
  const aged = deriver.update({ last_judge: "perfect", judges: { perfect: 1 } }, 1.2);
  assert.ok(Math.abs(aged.judgmentAge - 0.2) < 1e-12);
  const repeated = deriver.update({ last_judge: "perfect", judges: { perfect: 2 } }, 1.3);
  assert.equal(repeated.judgmentAge, 0);
});

test("defaults unavailable score capabilities without displaying a judgment", () => {
  const state = new HudStateDeriver().update({}, 1);
  assert.equal(state.hud.score, 0);
  assert.equal(state.combo, 0);
  assert.equal(state.comboAnimationAge, Infinity);
  assert.equal(state.comboAnimationFrom, 0);
  assert.equal(state.hud.accuracy, 0);
  assert.equal(state.judgment, null);
  assert.equal(state.judgmentAge, Infinity);
  assert.deepEqual(state.hitErrorMeter, { windows: null, ticks: [], floatingError: 0, age: Infinity });
});

test("retains each hit error once and expires ticks after ten seconds", () => {
  const deriver = new HudStateDeriver();
  const hit_error = { sequence: 1, delta_time: 0.05, windows: [0.02, 0.06, 0.1] as const };
  const first = deriver.update({ hit_error }, 1);
  assert.deepEqual(first.hitErrorMeter.windows, [0.02, 0.06, 0.1]);
  assert.deepEqual(first.hitErrorMeter.ticks, [{ deltaTime: 0.05, age: 0 }]);
  assert.equal(first.hitErrorMeter.floatingError, 0);
  assert.equal(first.hitErrorMeter.age, 0);
  const moving = deriver.update({ hit_error }, 1.4);
  assert.ok(Math.abs(moving.hitErrorMeter.floatingError - 0.0075) < 1e-12);
  const same = deriver.update({ hit_error }, 2);
  assert.equal(same.hitErrorMeter.ticks.length, 1);
  assert.ok(Math.abs(same.hitErrorMeter.floatingError - 0.01) < 1e-12);
  assert.deepEqual(deriver.update({ hit_error }, 11).hitErrorMeter.ticks, []);
});

test("restarts combo animation only when combo increases", () => {
  const deriver = new HudStateDeriver();
  deriver.update({ combo: 1 }, 1);
  const aged = deriver.update({ combo: 1 }, 1.2);
  assert.ok(Math.abs(aged.comboAnimationAge - 0.2) < 1e-12);
  const increased = deriver.update({ combo: 2 }, 1.3);
  assert.equal(increased.comboAnimationAge, 0);
  assert.equal(increased.comboAnimationFrom, 1);
  const reset = deriver.update({ combo: 0 }, 1.4);
  assert.equal(reset.comboAnimationAge, Infinity);
});
