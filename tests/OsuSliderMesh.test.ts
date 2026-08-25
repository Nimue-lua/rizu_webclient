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
  assert.ok(mesh.wireframe_indices.length > 0);
  assert.deepEqual(mesh.bounds, { left: -20, top: -20, right: 120, bottom: 20 });
  assert.ok([...mesh.vertices].every(Number.isFinite));
  const vertex_count = mesh.vertices.length / 3;
  assert.ok([...mesh.indices].every((index) => index < vertex_count));
  assert.ok([...mesh.wireframe_indices].every((index) => index < vertex_count));
  assert.ok([...mesh.vertices].filter((_value, index) => index % 3 === 2).includes(0));
  assert.ok([...mesh.vertices].filter((_value, index) => index % 3 === 2).includes(1));
});

test("uses round join geometry at a multipart Bezier cusp", () => {
  const slider: OsuSlider = {
    ...straightSlider(), x: 362, y: 323, curve_type: "bezier", pixel_length: 160,
    control_points: [{ x: 385, y: 338 }, { x: 397, y: 354 }, { x: 397, y: 354 },
      { x: 394, y: 302 }, { x: 396, y: 234 }],
  };
  const path = OsuSliderPath.create(slider, 14);
  const mesh = createOsuSliderMesh(path, 20);
  const vertices = [...mesh.vertices];
  const cusp_centers = vertices.filter((_value, index) => index % 3 === 2 && vertices[index] === 0 &&
    Math.hypot(vertices[index - 2]! - 397, vertices[index - 1]! - 354) < 1e-6);
  assert.ok(cusp_centers.length > 0);
  assert.ok([...mesh.indices].every((index) => index < mesh.vertices.length / 3));
});

test("uses outer wedges instead of full circles along smooth curves", () => {
  const slider: OsuSlider = {
    ...straightSlider(), x: 224, y: 232, curve_type: "perfect", pixel_length: 90,
    control_points: [{ x: 272, y: 256 }, { x: 312, y: 252 }],
  };
  const path = OsuSliderPath.create(slider, 14);
  const mesh = createOsuSliderMesh(path, 20);
  const point_count = path.points.length;
  const full_disks_at_every_point_indices = point_count * 24 * 3;
  assert.ok(point_count > 3);
  assert.ok(mesh.indices.length < point_count * 12 + full_disks_at_every_point_indices);
  assert.ok([...mesh.vertices].every(Number.isFinite));
});
