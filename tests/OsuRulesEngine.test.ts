import assert from "node:assert/strict";
import test from "node:test";
import type { OsuChart } from "../src/chart/Chart";
import { osuCircleHitRadius } from "../src/gameplay/OsuCircleGeometry";
import { OsuCircleState } from "../src/gameplay/OsuCircleState";
import { OsuRulesEngine } from "../src/gameplay/OsuRulesEngine";
import { createOsuStandardTimingValues } from "../src/gameplay/timing/OsuStandardOdTimings";

function createChart(circles: readonly { x: number; y: number; absolute_time: number }[]): OsuChart {
  return {
    mode: "osu",
    approach_rate: 5,
    circle_size: 5,
    overall_difficulty: 5,
    hp_drain_rate: 5,
    object_count: circles.length,
    drain_length_seconds: 10,
    end_time: circles.at(-1)?.absolute_time ?? 0,
    primary_tempo: 120,
    circles,
  };
}

function createEngine(circles: readonly { x: number; y: number; absolute_time: number }[]): OsuRulesEngine {
  return new OsuRulesEngine(createChart(circles), createOsuStandardTimingValues(5), 1);
}

test("blocks a spatially acquired later circle while an earlier circle is live", () => {
  const engine = createEngine([
    { x: 206, y: 192, absolute_time: 1 },
    { x: 256, y: 192, absolute_time: 1.1 },
  ]);

  assert.equal(engine.click(256, 192, 1.1), "locked");
  assert.deepEqual([...engine.circle_states], [OsuCircleState.Pending, OsuCircleState.Pending]);
  assert.equal(engine.judgment_events.length, 0);
  assert.deepEqual(engine.circle_transients, [{ kind: "shake", object_index: 1, start_time: 1.1 }]);
});

test("unlocks a later circle exactly at the earlier late-50 deadline", () => {
  const engine = createEngine([
    { x: 100, y: 100, absolute_time: 1 },
    { x: 300, y: 200, absolute_time: 1.15 },
  ]);

  assert.equal(engine.click(300, 200, 1.15), "hit");
  assert.deepEqual([...engine.circle_states], [OsuCircleState.Pending, OsuCircleState.Hit]);
  assert.equal(engine.score.judges?.["300"], 1);
});

test("uses chart order deterministically for same-time circles", () => {
  const engine = createEngine([
    { x: 256, y: 192, absolute_time: 1 },
    { x: 256, y: 192, absolute_time: 1 },
  ]);

  assert.equal(engine.click(256, 192, 1), "hit");
  assert.equal(engine.judgment_events[0]?.object_index, 0);
  assert.equal(engine.click(256, 192, 1), "hit");
  assert.equal(engine.judgment_events[1]?.object_index, 1);
});

test("spatial misses and presses before appearance do not consume circles", () => {
  const engine = createEngine([{ x: 256, y: 192, absolute_time: 2 }]);

  assert.equal(engine.click(400, 300, 2), "spatial-miss");
  assert.equal(engine.click(256, 192, 0.7), "too-early");
  assert.equal(engine.circle_states[0], OsuCircleState.Pending);
  assert.equal(engine.judgment_events.length, 0);
});

test("preserves stable's independent strict 400ms hittable restriction", () => {
  const boundary = createEngine([{ x: 256, y: 192, absolute_time: 1 }]);
  assert.equal(boundary.click(256, 192, 0.6), "too-early");
  assert.equal(boundary.circle_states[0], OsuCircleState.Pending);

  const inside = createEngine([{ x: 256, y: 192, absolute_time: 1 }]);
  assert.equal(inside.click(256, 192, 0.601), "miss");
  assert.equal(inside.circle_states[0], OsuCircleState.Missed);
  assert.equal(inside.score.judges?.miss, 1);
});

test("accepts the stable cursor-radius boundary and rejects beyond it", () => {
  const radius = osuCircleHitRadius(5);
  const edge = createEngine([{ x: 256, y: 192, absolute_time: 1 }]);
  assert.equal(edge.click(256 + radius, 192, 1), "hit");

  const outside = createEngine([{ x: 256, y: 192, absolute_time: 1 }]);
  assert.equal(outside.click(256 + radius + 1e-6, 192, 1), "spatial-miss");
  assert.equal(outside.circle_states[0], OsuCircleState.Pending);
});

test("uses strict score boundaries and automatic miss timing", () => {
  const exact_300 = createEngine([{ x: 256, y: 192, absolute_time: 1 }]);
  assert.equal(exact_300.click(256, 192, 1.05), "hit");
  assert.equal(exact_300.score.judges?.["100"], 1);

  const exact_50 = createEngine([{ x: 256, y: 192, absolute_time: 1 }]);
  assert.equal(exact_50.click(256, 192, 1.15), "miss");
  assert.equal(exact_50.score.judges?.miss, 1);

  const automatic = createEngine([{ x: 256, y: 192, absolute_time: 1 }]);
  automatic.update(1.15);
  assert.equal(automatic.circle_states[0], OsuCircleState.Pending);
  automatic.update(1.15 + 1e-9);
  automatic.update(2);
  assert.equal(automatic.circle_states[0], OsuCircleState.Missed);
  assert.equal(automatic.judgment_events.length, 1);
  assert.equal(automatic.judgment_events[0]?.time, 1.15);
});

test("exposes bounded renderer-ready hit and miss animations", () => {
  const hit = createEngine([{ x: 256, y: 192, absolute_time: 1 }]);
  hit.click(256, 192, 1.05);
  assert.deepEqual(hit.circle_transients, [{
    kind: "hit", object_index: 0, start_time: 1.05, judgment: "100",
  }]);
  hit.update(2.15);
  assert.equal(hit.circle_transients.length, 0);

  const miss = createEngine([{ x: 256, y: 192, absolute_time: 1 }]);
  miss.update(1.16);
  assert.deepEqual(miss.circle_transients, [{ kind: "miss", object_index: 0, start_time: 1.16 }]);

  const aborted = createEngine(Array.from({ length: 10_000 }, (_, index) => ({
    x: 256, y: 192, absolute_time: index,
  })));
  aborted.update(Number.POSITIVE_INFINITY);
  assert.equal(aborted.circle_transients.length, 0);
});

test("restarts rather than accumulating repeated shake animations", () => {
  const engine = createEngine([
    { x: 206, y: 192, absolute_time: 1 },
    { x: 256, y: 192, absolute_time: 1.1 },
  ]);
  engine.click(256, 192, 1.05);
  engine.click(256, 192, 1.06);
  assert.deepEqual(engine.circle_transients, [{ kind: "shake", object_index: 1, start_time: 1.06 }]);
});

test("advances the active circle cursor as deadlines pass", () => {
  const engine = createEngine(Array.from({ length: 10_000 }, (_, index) => ({
    x: 256,
    y: 192,
    absolute_time: index,
  })));

  engine.update(9_000);
  assert.equal(engine.first_active_circle_index, 9_000);
  engine.update(9_000);
  assert.equal(engine.first_active_circle_index, 9_000);
  assert.equal(engine.judgment_events.length, 9_000);
});
