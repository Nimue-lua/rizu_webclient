import assert from "node:assert/strict";
import test from "node:test";
import type { OsuSlider } from "../src/chart/Chart";
import { OsuSliderPath } from "../src/gameplay/OsuSliderPath";
import { createOsuSliderMesh } from "../src/gameplay/renderer/OsuSliderMesh";

function straightSlider(): OsuSlider {
  return {
    kind: "slider", x: 0, y: 0, absolute_time: 0, hit_sound: 0, curve_type: "linear",
    control_points: [{ x: 100, y: 0 }], repeat_count: 1, pixel_length: 100,
    edge_sounds: [0, 0], edge_sets: [{ normal_set: 0, addition_set: 0 }, { normal_set: 0, addition_set: 0 }],
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    span_duration: 1, total_duration: 1, end_time: 1,
  };
}

test("creates finite indexed slider geometry with round bounds", () => {
  const mesh = createOsuSliderMesh(OsuSliderPath.create(straightSlider(), 14), 20);
  assert.ok(mesh.vertices.length > 0);
  assert.ok(mesh.indices.length > 0);
  assert.deepEqual(mesh.bounds, { left: -20, top: -20, right: 120, bottom: 20 });
  assert.ok([...mesh.vertices].every(Number.isFinite));
  const vertex_count = mesh.vertices.length / 3;
  assert.ok([...mesh.indices].every((index) => index < vertex_count));
  assert.ok([...mesh.vertices].filter((_value, index) => index % 3 === 2).includes(0));
  assert.ok([...mesh.vertices].filter((_value, index) => index % 3 === 2).includes(1));
});
