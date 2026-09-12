import assert from "node:assert/strict";
import test from "node:test";
import type { OsuSlider } from "../src/chart/Chart";
import { sliderSnakeRange } from "../src/gameplay/osu/rendering/OsuSliderForegroundRenderer";

function slider(repeat_count = 1): OsuSlider {
  return {
    kind: "slider", x: 0, y: 0, absolute_time: 1, hit_sound: 0, curve_type: "linear",
    control_points: [{ x: 100, y: 0 }], repeat_count, pixel_length: 100,
    edge_sounds: Array(repeat_count + 1).fill(0),
    edge_sets: Array.from({ length: repeat_count + 1 }, () => ({ normal_set: 0, addition_set: 0 })),
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    span_duration: 1, total_duration: repeat_count, end_time: 1 + repeat_count, tick_distances: [],
  };
}

test("snakes slider bodies in during the first third of preempt", () => {
  const object = slider();
  assert.deepEqual(sliderSnakeRange(object, 0.4, 0.6, false), { start: 0, end: 0 });
  assert.ok(Math.abs(sliderSnakeRange(object, 0.5, 0.6, false).end - 0.5) < 1e-12);
  assert.ok(Math.abs(sliderSnakeRange(object, 0.6, 0.6, false).end - 1) < 1e-12);
});

test("can disable snake-in independently", () => {
  assert.deepEqual(sliderSnakeRange(slider(), 0.4, 0.6, false, false, true), { start: 0, end: 1 });
});

test("snakes out only during the final span after a successful head", () => {
  const odd_final_span = slider(2);
  assert.deepEqual(sliderSnakeRange(odd_final_span, 1.5, 0.6, true), { start: 0, end: 1 });
  assert.deepEqual(sliderSnakeRange(odd_final_span, 2.5, 0.6, true), { start: 0, end: 0.5 });
  assert.deepEqual(sliderSnakeRange(odd_final_span, 3, 0.6, true), { start: 0, end: 0 });
  assert.deepEqual(sliderSnakeRange(odd_final_span, 3.1, 0.6, true), { start: 0, end: 0 });

  const even_final_span = slider(3);
  assert.deepEqual(sliderSnakeRange(even_final_span, 3.5, 0.6, true), { start: 0.5, end: 1 });
  assert.deepEqual(sliderSnakeRange(even_final_span, 4.1, 0.6, true), { start: 1, end: 1 });
  assert.deepEqual(sliderSnakeRange(even_final_span, 3.5, 0.6, false), { start: 0, end: 1 });
  assert.deepEqual(sliderSnakeRange(even_final_span, 3.5, 0.6, true, true, false), { start: 0, end: 1 });
});
