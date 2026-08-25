import assert from "node:assert/strict";
import test from "node:test";
import type { OsuSlider } from "../src/chart/Chart";
import { OsuSliderPath } from "../src/gameplay/OsuSliderPath";
import { OsuViewport } from "../src/gameplay/OsuViewport";
import { WebGlSliderGraphics } from "../src/gameplay/renderer/WebGlSliderGraphics";

function createSlider(): OsuSlider {
  return {
    kind: "slider", x: 0, y: 0, absolute_time: 0, hit_sound: 0, curve_type: "linear",
    control_points: [{ x: 100, y: 0 }], repeat_count: 1, pixel_length: 100,
    edge_sounds: [0, 0], edge_sets: [{ normal_set: 0, addition_set: 0 }, { normal_set: 0, addition_set: 0 }],
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    span_duration: 1, total_duration: 1, end_time: 1,
  };
}

function createGl() {
  let id = 0;
  const calls = { buffers: 0, deleted_buffers: 0, arrays: 0, deleted_arrays: 0, draws: 0, deleted_programs: 0 };
  const handle = () => ({ id: ++id });
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5,
    ELEMENT_ARRAY_BUFFER: 6, FLOAT: 7, STATIC_DRAW: 8, BLEND: 9, ONE: 10, ONE_MINUS_SRC_ALPHA: 11,
    TRIANGLES: 12, UNSIGNED_INT: 13,
    createShader: handle, shaderSource() {}, compileShader() {}, getShaderParameter: () => true,
    getShaderInfoLog: () => null, deleteShader() {}, createProgram: handle, attachShader() {}, linkProgram() {},
    getProgramParameter: () => true, getProgramInfoLog: () => null,
    deleteProgram() { calls.deleted_programs += 1; }, getUniformLocation: handle,
    createVertexArray() { calls.arrays += 1; return handle(); },
    deleteVertexArray(value: object | null) { if (value) calls.deleted_arrays += 1; }, bindVertexArray() {},
    createBuffer() { calls.buffers += 1; return handle(); },
    deleteBuffer(value: object | null) { if (value) calls.deleted_buffers += 1; }, bindBuffer() {}, bufferData() {},
    getAttribLocation: (_program: object, name: string) => name === "position" ? 0 : 1,
    enableVertexAttribArray() {}, vertexAttribPointer() {}, useProgram() {}, uniform2f() {}, uniform4f() {},
    uniform1f() {}, enable() {}, blendFunc() {}, drawElements() { calls.draws += 1; },
  } as unknown as WebGL2RenderingContext;
  return { gl, calls };
}

test("uploads each slider once, draws indexed geometry, and destroys owned buffers", () => {
  const fake = createGl();
  const graphics = new WebGlSliderGraphics({ getContext: () => fake.gl } as unknown as HTMLCanvasElement);
  const slider = createSlider();
  const path = OsuSliderPath.create(slider, 14);
  assert.equal(graphics.upload(slider, path, 20), true);
  assert.equal(graphics.upload(slider, path, 20), true);
  assert.equal(fake.calls.buffers, 2);
  assert.equal(fake.calls.arrays, 1);
  graphics.draw(slider, new OsuViewport(640, 480), {
    framebuffer_width: 640, framebuffer_height: 480, logical_width: 640, logical_height: 480,
  }, [1, 0, 0, 1], [1, 1, 1, 1], 1);
  assert.equal(fake.calls.draws, 1);
  graphics.destroy();
  graphics.destroy();
  assert.equal(fake.calls.deleted_buffers, 2);
  assert.equal(fake.calls.deleted_arrays, 1);
  assert.equal(fake.calls.deleted_programs, 1);
});
