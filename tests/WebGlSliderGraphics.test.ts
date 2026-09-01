import assert from "node:assert/strict";
import test from "node:test";
import type { OsuSlider } from "../src/chart/Chart";
import { OsuSliderPath } from "../src/gameplay/osu/OsuSliderPath";
import { OsuViewport } from "../src/gameplay/osu/OsuViewport";
import { WebGlSliderGraphics } from "../src/gameplay/osu/rendering/WebGlSliderGraphics";

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
    depth_funcs: [] as number[], clear_masks: [] as number[], stencil_funcs: [] as number[][],
    stencil_ops: [] as number[][], stencil_masks: [] as number[], clear_stencils: [] as number[],
    uniform2: [] as number[][], uniform1: [] as number[], framebuffers: 0, textures: 0, renderbuffers: 0, array_draws: 0,
    framebuffer_bindings: [] as (object | null)[], viewports: [] as number[][], deleted_programs: 0 };
  const handle = () => ({ id: ++id });
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5,
    ELEMENT_ARRAY_BUFFER: 6, FLOAT: 7, STATIC_DRAW: 8, BLEND: 9, ONE: 10, ONE_MINUS_SRC_ALPHA: 11,
    TRIANGLES: 12, UNSIGNED_INT: 13, DEPTH_TEST: 14, DEPTH_BUFFER_BIT: 15, LEQUAL: 16, LESS: 17,
    MAX_VIEWPORT_DIMS: 18, SCISSOR_TEST: 19, EQUAL: 37, STENCIL_TEST: 38, STENCIL_BUFFER_BIT: 128,
    KEEP: 39, REPLACE: 40, NOTEQUAL: 41,
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
    getAttribLocation: (_program: object, name: string) =>
      ({ position: 0, segment_start: 1, segment_end: 2 })[name] ?? -1,
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
    enable() {}, disable() {}, blendFunc() {},
    depthFunc(value: number) { calls.depth_funcs.push(value); }, clearDepth() {},
    clear(mask: number) { calls.clear_masks.push(mask); },
    clearStencil(value: number) { calls.clear_stencils.push(value); },
    stencilMask(value: number) { calls.stencil_masks.push(value); },
    stencilFunc(...values: number[]) { calls.stencil_funcs.push(values); },
    stencilOp(...values: number[]) { calls.stencil_ops.push(values); },
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
  assert.match(fake.calls.shader_sources[0]!, /in vec2 segment_start;/);
  assert.match(fake.calls.shader_sources[1]!, /distance\(path_position,/);
  assert.match(fake.calls.shader_sources[1]!, /gl_FragDepth = radial/);
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
  assert.deepEqual(fake.calls.depth_funcs, [fake.gl.LEQUAL, fake.gl.EQUAL]);
  assert.deepEqual(fake.calls.clear_stencils, [0]);
  assert.deepEqual(fake.calls.clear_masks, [fake.gl.DEPTH_BUFFER_BIT | fake.gl.STENCIL_BUFFER_BIT]);
  assert.deepEqual(fake.calls.stencil_funcs, [[fake.gl.NOTEQUAL, 1, 0xff]]);
  assert.deepEqual(fake.calls.stencil_ops, [[fake.gl.KEEP, fake.gl.KEEP, fake.gl.REPLACE]]);
  assert.deepEqual(fake.calls.stencil_masks, [0xff, 0xff]);
  assert.deepEqual(fake.calls.color_masks, [[false, false, false, false], [true, true, true, true]]);
  assert.deepEqual(fake.calls.scissors, [[0, 0, 640, 480]]);
  graphics.destroy();
  graphics.destroy();
  assert.equal(fake.calls.deleted_buffers, 2);
  assert.equal(fake.calls.deleted_arrays, 1);
  assert.equal(fake.calls.deleted_programs, 1);
});
