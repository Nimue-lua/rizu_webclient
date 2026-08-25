import assert from "node:assert/strict";
import test from "node:test";
import type { OsuChart, OsuHitObject, OsuSlider } from "../src/chart/Chart";
import { osuCircleHitRadius } from "../src/gameplay/OsuCircleGeometry";
import { OsuCircleState } from "../src/gameplay/OsuCircleState";
import { OsuRulesEngine } from "../src/gameplay/OsuRulesEngine";
import { createOsuStandardTimingValues } from "../src/gameplay/timing/OsuStandardOdTimings";

function createChart(circles: readonly { x: number; y: number; absolute_time: number }[]): OsuChart {
  const hit_objects = circles.map((circle) => ({ kind: "circle" as const, ...circle, hit_sound: 0,
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" } }));
  return {
    mode: "osu",
    format_version: 14,
    approach_rate: 5,
    circle_size: 5,
    overall_difficulty: 5,
    hp_drain_rate: 5,
    object_count: circles.length,
    drain_length_seconds: 10,
    end_time: circles.at(-1)?.absolute_time ?? 0,
    primary_tempo: 120,
    slider_multiplier: 1.4,
    slider_tick_rate: 1,
    combo_colors: [],
    timing_points: [],
    hit_objects,
  };
}

function createEngine(circles: readonly { x: number; y: number; absolute_time: number }[]): OsuRulesEngine {
  return new OsuRulesEngine(createChart(circles), createOsuStandardTimingValues(5), 1);
}

const sample = { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" };

function createObjectEngine(hit_objects: readonly OsuHitObject[]): OsuRulesEngine {
  return new OsuRulesEngine({ ...createChart([]), object_count: hit_objects.length,
    end_time: hit_objects.reduce((end, object) => Math.max(end,
      object.kind === "circle" ? object.absolute_time : object.end_time), 0), hit_objects },
  createOsuStandardTimingValues(5), 1);
}

function slider(overrides: Partial<OsuSlider> = {}): OsuSlider {
  return {
    kind: "slider", x: 100, y: 100, absolute_time: 1, hit_sound: 0, hit_sample: sample,
    new_combo: false, combo_skip: 0, combo_number: 1, combo_color_index: 0,
    curve_type: "linear", control_points: [{ x: 300, y: 100 }], repeat_count: 1,
    pixel_length: 200, edge_sounds: [0, 0], edge_sets: [{ normal_set: 0, addition_set: 0 },
      { normal_set: 0, addition_set: 0 }], span_duration: 1, total_duration: 1, end_time: 2,
    tick_distances: [100], ...overrides,
  };
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

test("judges slider heads with circle windows and stable note lock", () => {
  const engine = createObjectEngine([
    { kind: "circle", x: 50, y: 50, absolute_time: 0.95, hit_sound: 0, hit_sample: sample,
      new_combo: false, combo_skip: 0, combo_number: 1, combo_color_index: 0 },
    slider(),
  ]);
  engine.setInput(100, 100, true, 1);
  assert.equal(engine.click(100, 100, 1), "locked");
  engine.update(1.1);
  assert.equal(engine.click(100, 100, 1.1), "hit");
  assert.equal(engine.judgment_events.at(-1)?.kind, "slider-head");
  assert.equal(engine.slider_state?.object_index, 1);
});

test("does not start following from an early slider-head hit until slider time", () => {
  const engine = createObjectEngine([slider()]);
  engine.setInput(100, 100, true, 0.9);
  assert.equal(engine.click(100, 100, 0.9), "hit");
  assert.equal(engine.slider_state?.tracking, false);
  assert.equal(engine.slider_state?.tracking_started_at, null);
  engine.update(1);
  assert.equal(engine.slider_state?.tracking, true);
  assert.equal(engine.slider_state?.tracking_started_at, 1);
});

test("tracks slider ticks, repeats, and the lenient tail along the shared path", () => {
  const object = slider({ repeat_count: 2, total_duration: 2, end_time: 3,
    edge_sounds: [0, 0, 0], edge_sets: Array.from({ length: 3 }, () => ({ normal_set: 0, addition_set: 0 })) });
  const engine = createObjectEngine([object]);
  engine.setInput(100, 100, true, 1);
  assert.equal(engine.click(100, 100, 1), "hit");

  for (let step = 1; step <= 19; step += 1) {
    const time = 1 + step / 10;
    const progress = step <= 10 ? step / 10 : 2 - step / 10;
    engine.setInput(100 + progress * 200, 100, true, time);
  }
  engine.setInput(107.2, 100, true, 2.964);
  assert.equal(engine.slider_state?.active, true);
  engine.update(3);

  assert.deepEqual(engine.judgment_events.map((event) => event.kind === "slider-point" ? event.point_kind : event.kind),
    ["slider-head", "tick", "repeat", "tick", "tail", "slider-end"]);
  assert.equal(engine.score.judges?.["300"], 1);
  assert.equal(engine.score.combo, 5);
  assert.equal(engine.score.score, 458);
  assert.equal(engine.slider_state, null);
  assert.deepEqual(engine.circle_transients, [{
    kind: "hit", object_index: 0, start_time: 3, judgment: "300", position: { x: 100, y: 100 },
  }]);
});

test("shows a slider-head miss immediately and the aggregate judgment at slider end", () => {
  const object = slider();
  const engine = createObjectEngine([object]);
  engine.update(1.16);

  assert.deepEqual(engine.circle_transients, [{
    kind: "miss", object_index: 0, start_time: 1.16, position: { x: 100, y: 100 },
  }]);
  engine.update(2);
  assert.deepEqual(engine.circle_transients.at(-1), {
    kind: "miss", object_index: 0, start_time: 2, position: { x: 300, y: 100 },
  });
});

test("uses the acquired follow radius and breaks combo on missed slider points", () => {
  const engine = createObjectEngine([slider()]);
  engine.setInput(100, 100, true, 1);
  engine.click(100, 100, 1);
  const radius = osuCircleHitRadius(5);
  engine.setInput(140, 100 + radius * 2, true, 1.2);
  assert.equal(engine.slider_state?.tracking, true);
  engine.setInput(158, 100 + radius * 2.4, true, 1.29);
  assert.equal(engine.slider_state?.tracking, false);
  engine.update(1.5);
  engine.setInput(280, 100, true, 1.9);
  engine.update(1.964);
  engine.update(2);
  assert.equal(engine.score.judges?.["100"], 1);
  assert.equal(engine.score.combo, 1);
});

test("starts and completes spinner rules from timestamped cursor samples", () => {
  const spinner = { kind: "spinner" as const, x: 256, y: 192, absolute_time: 1, end_time: 2,
    hit_sound: 0, hit_sample: sample, new_combo: false, combo_skip: 0, combo_number: null,
    combo_color_index: 0 };
  const engine = createObjectEngine([spinner]);
  engine.setInput(356, 192, true, 1);
  for (let index = 1; index <= 32; index += 1) {
    const angle = index * Math.PI / 4;
    engine.setInput(256 + Math.cos(angle) * 100, 192 + Math.sin(angle) * 100, true, 1 + index / 40);
  }
  engine.update(2);
  assert.equal(engine.score.judges?.["300"], 1);
  assert.equal(engine.spinner_state, null);
});
