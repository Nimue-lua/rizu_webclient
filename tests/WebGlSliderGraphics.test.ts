import assert from "node:assert/strict";
import test from "node:test";
import type { OsuSlider } from "../src/chart/Chart";
import { OsuSliderPath } from "../src/gameplay/osu/OsuSliderPath";
import { OsuViewport } from "../src/gameplay/osu/OsuViewport";
import { osuSliderRendererMode, stableBodyTransform, WebGlSliderGraphics } from "../src/gameplay/osu/rendering/WebGlSliderGraphics";

function createSlider(): OsuSlider {
  return {
    kind: "slider", x: 0, y: 0, absolute_time: 0, hit_sound: 0, curve_type: "linear",
    control_points: [{ x: 100, y: 0 }], repeat_count: 1, pixel_length: 100,
    edge_sounds: [0, 0], edge_sets: [{ normal_set: 0, addition_set: 0 }, { normal_set: 0, addition_set: 0 }],
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    span_duration: 1, total_duration: 1, end_time: 1,
    tick_distances: [],
  };
}

function createGl(max_viewport = 16_384) {
  let id = 0;
  const calls = { buffers: 0, deleted_buffers: 0, arrays: 0, deleted_arrays: 0, draws: 0,
    shader_sources: [] as string[],
    depth_masks: [] as boolean[], color_masks: [] as boolean[][], scissors: [] as number[][],
    uniform2: [] as number[][], uniform1: [] as number[], framebuffers: 0, textures: 0, renderbuffers: 0, array_draws: 0,
    framebuffer_bindings: [] as (object | null)[], viewports: [] as number[][], deleted_programs: 0 };
  const handle = () => ({ id: ++id });
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5,
    ELEMENT_ARRAY_BUFFER: 6, FLOAT: 7, STATIC_DRAW: 8, BLEND: 9, ONE: 10, ONE_MINUS_SRC_ALPHA: 11,
    TRIANGLES: 12, UNSIGNED_INT: 13, DEPTH_TEST: 14, DEPTH_BUFFER_BIT: 15, LEQUAL: 16, LESS: 17,
    MAX_VIEWPORT_DIMS: 18, SCISSOR_TEST: 19,
    FRAMEBUFFER: 20, RENDERBUFFER: 21, TEXTURE_2D: 22, TEXTURE_MIN_FILTER: 23, TEXTURE_MAG_FILTER: 24,
    TEXTURE_WRAP_S: 25, TEXTURE_WRAP_T: 26, LINEAR: 27, CLAMP_TO_EDGE: 28, RGBA8: 29, RGBA: 30,
    UNSIGNED_BYTE: 31, DEPTH_COMPONENT16: 32, COLOR_ATTACHMENT0: 33, DEPTH_ATTACHMENT: 34,
    FRAMEBUFFER_COMPLETE: 35, COLOR_BUFFER_BIT: 64, TEXTURE0: 36,
    createShader: handle, shaderSource(_shader: object, source: string) { calls.shader_sources.push(source); },
    compileShader() {}, getShaderParameter: () => true,
    getShaderInfoLog: () => null, deleteShader() {}, createProgram: handle, attachShader() {}, linkProgram() {},
    getProgramParameter: () => true, getProgramInfoLog: () => null,
    getParameter: () => new Int32Array([max_viewport, max_viewport]),
    deleteProgram() { calls.deleted_programs += 1; }, getUniformLocation: handle,
    createVertexArray() { calls.arrays += 1; return handle(); },
    deleteVertexArray(value: object | null) { if (value) calls.deleted_arrays += 1; }, bindVertexArray() {},
    createBuffer() { calls.buffers += 1; return handle(); },
    deleteBuffer(value: object | null) { if (value) calls.deleted_buffers += 1; }, bindBuffer() {}, bufferData() {},
    getAttribLocation: (_program: object, name: string) => name === "position" ? 0 : 1,
    enableVertexAttribArray() {}, vertexAttribPointer() {}, useProgram() {},
    uniform2f(_uniform: object, ...values: number[]) { calls.uniform2.push(values); }, uniform4f() {},
    createFramebuffer() { calls.framebuffers += 1; return handle(); }, deleteFramebuffer() {},
    bindFramebuffer(_target: number, value: object | null) { calls.framebuffer_bindings.push(value); },
    createTexture() { calls.textures += 1; return handle(); }, deleteTexture() {}, bindTexture() {}, texParameteri() {}, texImage2D() {},
    createRenderbuffer() { calls.renderbuffers += 1; return handle(); }, deleteRenderbuffer() {}, bindRenderbuffer() {},
    renderbufferStorage() {}, framebufferTexture2D() {}, framebufferRenderbuffer() {},
    checkFramebufferStatus: () => 35, viewport(...values: number[]) { calls.viewports.push(values); },
    activeTexture() {}, uniform1i() {}, clearColor() {},
    uniform1f(_uniform: object, value: number) { calls.uniform1.push(value); },
    enable() {}, disable() {}, blendFunc() {}, depthFunc() {}, clearDepth() {}, clear() {},
    depthMask(value: boolean) { calls.depth_masks.push(value); },
    colorMask(...values: boolean[]) { calls.color_masks.push(values); },
    scissor(...values: number[]) { calls.scissors.push(values); },
    drawElements() { calls.draws += 1; },
    drawArrays() { calls.array_draws += 1; },
  } as unknown as WebGL2RenderingContext;
  return { gl, calls };
}

test("uploads each slider once, draws indexed geometry, and destroys owned buffers", () => {
  const fake = createGl();
  const graphics = new WebGlSliderGraphics({ getContext: () => fake.gl } as unknown as HTMLCanvasElement);
  assert.match(fake.calls.shader_sources[0]!, /out float radial;/);
  assert.match(fake.calls.shader_sources[0]!, /radial = edge_distance;/);
  assert.match(fake.calls.shader_sources[1]!, /in float radial;/);
  const slider = createSlider();
  const path = OsuSliderPath.create(slider, 14);
  assert.equal(graphics.upload(slider, path, 20), true);
  assert.equal(graphics.upload(slider, path, 20), true);
  assert.equal(fake.calls.buffers, 2);
  assert.equal(fake.calls.arrays, 1);
  graphics.draw(slider, new OsuViewport(640, 480), {
    framebuffer_width: 640, framebuffer_height: 480, logical_width: 640, logical_height: 480,
  }, [1, 0, 0, 1], [1, 1, 1, 1], 1);
  assert.equal(fake.calls.draws, 2);
  assert.deepEqual(fake.calls.depth_masks, [true, false]);
  assert.deepEqual(fake.calls.color_masks, [[false, false, false, false], [true, true, true, true]]);
  assert.deepEqual(fake.calls.scissors, [[0, 0, 640, 480]]);
  graphics.destroy();
  graphics.destroy();
  assert.equal(fake.calls.deleted_buffers, 2);
  assert.equal(fake.calls.deleted_arrays, 1);
  assert.equal(fake.calls.deleted_programs, 1);
});

test("selects the experimental stable renderer explicitly", () => {
  assert.equal(osuSliderRendererMode(null), "direct");
  assert.equal(osuSliderRendererMode("unknown"), "direct");
  assert.equal(osuSliderRendererMode("stable"), "stable");
  const fake = createGl();
  const graphics = new WebGlSliderGraphics({ getContext: () => fake.gl } as unknown as HTMLCanvasElement, "stable");
  assert.match(fake.calls.shader_sources[2]!, /texture_position = corner;/);
  const slider = createSlider();
  assert.equal(graphics.upload(slider, OsuSliderPath.create(slider, 14), 20), true);
  graphics.draw(slider, new OsuViewport(640, 480), {
    framebuffer_width: 640, framebuffer_height: 480, logical_width: 640, logical_height: 480,
  }, [1, 0, 0, 1], [1, 1, 1, 1], 1);
  assert.deepEqual(fake.calls.scissors, []);
  assert.equal(fake.calls.framebuffers, 1);
  assert.equal(fake.calls.textures, 1);
  assert.equal(fake.calls.renderbuffers, 1);
  assert.equal(fake.calls.draws, 1);
  assert.equal(fake.calls.array_draws, 1);
  assert.ok(fake.calls.uniform1.includes(-1));
  assert.deepEqual(fake.calls.viewports, [[0, 0, 146, 46], [0, 0, 640, 480]]);
  graphics.draw(slider, new OsuViewport(640, 480), {
    framebuffer_width: 640, framebuffer_height: 480, logical_width: 640, logical_height: 480,
  }, [1, 0, 0, 1], [1, 1, 1, 1], 1);
  assert.equal(fake.calls.framebuffers, 1);
  graphics.destroy();
});

test("caps modern WebGL viewport limits to stable's historical 16384 pixels", () => {
  const fake = createGl(32_768);
  const graphics = new WebGlSliderGraphics({ getContext: () => fake.gl } as unknown as HTMLCanvasElement, "stable");
  const slider: OsuSlider = { ...createSlider(), pixel_length: 20_000,
    control_points: [{ x: 20_000, y: 0 }] };
  assert.equal(graphics.upload(slider, OsuSliderPath.create(slider, 14), 20), true);
  graphics.draw(slider, new OsuViewport(640, 480), {
    framebuffer_width: 640, framebuffer_height: 480, logical_width: 640, logical_height: 480,
  }, [1, 0, 0, 1], [1, 1, 1, 1], 1);
  assert.deepEqual(fake.calls.viewports[0], [0, 0, 16_384, 46]);
  graphics.destroy();
});

test("emulates stable viewport clamping without a slider framebuffer", () => {
  const viewport = new OsuViewport(640, 480);
  const frame = { framebuffer_width: 640, framebuffer_height: 480, logical_width: 640, logical_height: 480 };
  const horizontal = stableBodyTransform(
    { left: -29_958, top: -20.5, right: 488.5, bottom: 398.5 }, 36.5, viewport, frame, [16_384, 16_384]);
  assert.equal(horizontal.origin_x, 0);
  assert.ok(Math.abs(horizontal.scale_x - 16_384 / 30_456) < 0.0001);
  assert.equal(horizontal.scale_y, 1);

  const vertical = stableBodyTransform(
    { left: 48.5, top: -30_021.5, right: 467.5, bottom: 423.5 }, 36.5, viewport, frame, [16_384, 16_384]);
  assert.equal(vertical.origin_y, 0);
  assert.equal(vertical.scale_x, 1);
  assert.equal(vertical.scale_y, 1);
});
