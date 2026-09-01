import assert from "node:assert/strict";
import test from "node:test";
import type { OsuSlider, OsuSliderCurveType } from "../src/chart/Chart";
import { createOsuSliderPaths, OsuSliderPath } from "../src/gameplay/osu/OsuSliderPath";

function slider(curve_type: OsuSliderCurveType, control_points: readonly { x: number; y: number }[],
  pixel_length: number): OsuSlider {
  return {
    kind: "slider", x: 0, y: 0, absolute_time: 1, hit_sound: 0, curve_type, control_points,
    repeat_count: 1, pixel_length, edge_sounds: [0, 0],
    edge_sets: [{ normal_set: 0, addition_set: 0 }, { normal_set: 0, addition_set: 0 }],
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    span_duration: 1, total_duration: 1, end_time: 2,
    tick_distances: [],
  };
}

test("trims and extends linear paths to declared pixel length", () => {
  const trimmed = OsuSliderPath.create(slider("linear", [{ x: 100, y: 0 }], 40), 14);
  assert.deepEqual(trimmed.points, [{ x: 0, y: 0 }, { x: 40, y: 0 }]);
  assert.equal(trimmed.length, 40);
  const extended = OsuSliderPath.create(slider("linear", [{ x: 20, y: 0 }], 50), 14);
  assert.deepEqual(extended.points, [{ x: 0, y: 0 }, { x: 50, y: 0 }]);
  assert.deepEqual(extended.directionAtProgress(0.5), { x: 1, y: 0 });
  assert.equal(extended.angleAtProgress(1), 0);
});

test("prepares one shared path for every chart slider", () => {
  const first = slider("linear", [{ x: 100, y: 0 }], 100);
  const second = { ...slider("bezier", [{ x: 50, y: 50 }, { x: 100, y: 0 }], 120), absolute_time: 3 };
  const circle = { kind: "circle" as const, x: 20, y: 30, absolute_time: 2, hit_sound: 0,
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" } };
  const chart = { mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, overall_difficulty: 5,
    hp_drain_rate: 5, object_count: 3, drain_length_seconds: 3, end_time: 4, primary_tempo: 120,
    slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [],
    hit_objects: [first, circle, second] } as const;

  const paths = createOsuSliderPaths(chart);

  assert.equal(paths.size, 2);
  assert.ok(paths.has(first));
  assert.ok(paths.has(second));
});

test("builds stable perfect-circle and Catmull paths", () => {
  const perfect = OsuSliderPath.create(slider("perfect", [{ x: 50, y: -50 }, { x: 100, y: 0 }], 157), 14);
  assert.ok(perfect.points.length > 10);
  const middle = perfect.positionAtProgress(0.5);
  assert.ok(Math.abs(middle.x - 50) < 2);
  assert.ok(Math.abs(middle.y + 50) < 2);
  const catmull = OsuSliderPath.create(slider("catmull", [{ x: 50, y: 50 }, { x: 100, y: 0 }], 120), 14);
  assert.ok(catmull.points.length > 50);
  assert.deepEqual(catmull.points[0], { x: 0, y: 0 });
});

test("preserves the v9 wrong Bezier sampler separately from modern Bezier", () => {
  const source = slider("bezier", [{ x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }], 80);
  const wrong = OsuSliderPath.create(source, 9);
  const modern = OsuSliderPath.create(source, 10);
  assert.notDeepEqual(wrong.points, modern.points);
  assert.ok(Math.abs(wrong.length - 80) < 1e-9);
  assert.ok(Math.abs(modern.length - 80) < 1e-9);
});

test("supports multipart and degenerate paths with repeat-aware endpoints", () => {
  const path = OsuSliderPath.create(slider("bezier", [
    { x: 50, y: 50 }, { x: 50, y: 50 }, { x: 100, y: 0 },
  ], 120), 14);
  assert.equal(path.endPosition(2), path.points[0]);
  assert.equal(path.endPosition(3), path.points.at(-1));
  const degenerate = OsuSliderPath.create(slider("linear", [], 20), 14);
  assert.equal(degenerate.length, 0);
  assert.deepEqual(degenerate.positionAtDistance(100), { x: 0, y: 0 });
});

test("degrades adversarial high-degree Beziers within deterministic bounds", () => {
  const controls = Array.from({ length: 2_000 }, (_, index) => ({ x: index % 2 ? 512 : 0, y: index }));
  const path = OsuSliderPath.create(slider("bezier", controls, 10_000), 14);
  assert.equal(path.degraded, true);
  assert.ok(path.points.length <= 2_001);
  assert.ok(path.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
});
