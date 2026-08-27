import assert from "node:assert/strict";
import test from "node:test";
import type { OsuChart, OsuHitObject } from "../src/chart/Chart";
import { applyOsuHitObjectStacking } from "../src/gameplay/osu/OsuHitObjectStacking";

const hit_sample = { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" };

function chart(hit_objects: readonly OsuHitObject[], format_version = 14): OsuChart {
  return {
    mode: "osu", format_version, stack_leniency: 0.7, approach_rate: 5, circle_size: 5,
    end_time: 3, overall_difficulty: 5, hp_drain_rate: 5, object_count: hit_objects.length,
    drain_length_seconds: 2, primary_tempo: 120, slider_multiplier: 1.4, slider_tick_rate: 1,
    combo_colors: [], timing_points: [], hit_objects,
  };
}

function circle(x: number, y: number, absolute_time: number): OsuHitObject {
  return { kind: "circle", x, y, absolute_time, hit_sound: 0, hit_sample,
    new_combo: false, combo_skip: 0, combo_number: 1, combo_color_index: 0 };
}

test("stacks overlapping modern circles up and left without mutating the parsed chart", () => {
  const original = chart([circle(100, 100, 1), circle(100, 100, 1.1), circle(100, 100, 1.2)]);
  const stacked = applyOsuHitObjectStacking(original);

  assert.deepEqual(stacked.hit_objects.map(({ x, y }) => [x, y]), [
    [93.6, 93.6], [96.8, 96.8], [100, 100],
  ]);
  assert.deepEqual(original.hit_objects.map(({ x, y }) => [x, y]), [[100, 100], [100, 100], [100, 100]]);
});

test("moves circles beneath a slider tail down and right", () => {
  const slider: OsuHitObject = {
    kind: "slider", x: 100, y: 100, absolute_time: 1, end_time: 1.4, hit_sound: 0, hit_sample,
    new_combo: false, combo_skip: 0, combo_number: 1, combo_color_index: 0,
    curve_type: "linear", control_points: [{ x: 200, y: 100 }], repeat_count: 1, pixel_length: 100,
    edge_sounds: [0, 0], edge_sets: [{ normal_set: 0, addition_set: 0 }, { normal_set: 0, addition_set: 0 }],
    span_duration: 0.4, total_duration: 0.4, tick_distances: [],
  };
  const stacked = applyOsuHitObjectStacking(chart([slider, circle(200, 100, 1.5), circle(200, 100, 1.6)]));

  assert.deepEqual(stacked.hit_objects.map(({ x, y }) => [x, y]), [
    [100, 100], [203.2, 103.2], [206.4, 106.4],
  ]);
});

test("translates an entire stacked slider path", () => {
  const slider: OsuHitObject = {
    kind: "slider", x: 100, y: 100, absolute_time: 1, end_time: 1.4, hit_sound: 0, hit_sample,
    new_combo: false, combo_skip: 0, combo_number: 1, combo_color_index: 0,
    curve_type: "linear", control_points: [{ x: 200, y: 100 }], repeat_count: 1, pixel_length: 100,
    edge_sounds: [0, 0], edge_sets: [{ normal_set: 0, addition_set: 0 }, { normal_set: 0, addition_set: 0 }],
    span_duration: 0.4, total_duration: 0.4, tick_distances: [],
  };
  const stacked = applyOsuHitObjectStacking(chart([slider, circle(100, 100, 1.1)]));

  assert.deepEqual([stacked.hit_objects[0]!.x, stacked.hit_objects[0]!.y], [96.8, 96.8]);
  assert.deepEqual(stacked.hit_objects[0]?.kind === "slider" ? stacked.hit_objects[0].control_points : null,
    [{ x: 196.8, y: 96.8 }]);
  assert.deepEqual([stacked.hit_objects[1]!.x, stacked.hit_objects[1]!.y], [100, 100]);
});

test("uses effective AR and StackLeniency for the stacking time threshold", () => {
  const original = { ...chart([circle(100, 100, 1), circle(100, 100, 1.7)]), stack_leniency: 0.5 };
  const ar5 = applyOsuHitObjectStacking(original, 5);
  const ar0 = applyOsuHitObjectStacking(original, 0);

  assert.equal(ar5.hit_objects[0]!.x, 100);
  assert.equal(ar0.hit_objects[0]!.x, 96.8);
});
