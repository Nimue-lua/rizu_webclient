import assert from "node:assert/strict";
import test from "node:test";
import type { Sprite, SpriteDrawCommand } from "../src/gameplay/renderer/Sprite";
import { WebGlSpriteGraphics } from "../src/gameplay/renderer/WebGlSpriteGraphics";

function createSprite(name: string): Sprite {
  return {
    image: { width: 10, height: 10, name } as unknown as ImageBitmap,
    sourceSize: { w: 10, h: 10 },
    pixelSize: { w: 10, h: 10 },
  };
}

function createGl() {
  let id = 0;
  const calls = {
    created_textures: [] as object[],
    deleted_textures: [] as object[],
    deleted_buffers: 0,
    deleted_vertex_arrays: 0,
    deleted_programs: 0,
    draw_textures: [] as object[],
    uploaded_vertices: [] as Float32Array[],
    current_texture: null as object | null,
    uploaded_images: [] as object[],
  };
  const handle = () => ({ id: ++id });
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, FLOAT: 6, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 7, TEXTURE0: 8,
    TEXTURE_2D: 9, TEXTURE_MIN_FILTER: 10, LINEAR: 11, TEXTURE_MAG_FILTER: 12,
    TEXTURE_WRAP_S: 13, CLAMP_TO_EDGE: 14, TEXTURE_WRAP_T: 15, RGBA8: 16, MAX_TEXTURE_SIZE: 25,
    RGBA: 17, UNSIGNED_BYTE: 18, NO_ERROR: 0, BLEND: 19, ONE: 20,
    ONE_MINUS_SRC_ALPHA: 21, COLOR_BUFFER_BIT: 22, DYNAMIC_DRAW: 23, TRIANGLES: 24,
    createShader: handle, shaderSource() {}, compileShader() {}, getShaderParameter: () => true,
    getShaderInfoLog: () => null, deleteShader() {}, createProgram: handle, attachShader() {}, linkProgram() {},
    getProgramParameter: () => true, getProgramInfoLog: () => null,
    deleteProgram() { calls.deleted_programs += 1; }, createVertexArray: handle, createBuffer: handle,
    getUniformLocation: handle, deleteBuffer() { calls.deleted_buffers += 1; },
    deleteVertexArray() { calls.deleted_vertex_arrays += 1; }, bindVertexArray() {}, bindBuffer() {},
    getAttribLocation: (_program: object, name: string) => ({ position: 0, texture_position: 1, vertex_color: 2 })[name]!,
    enableVertexAttribArray() {}, vertexAttribPointer() {}, pixelStorei() {}, activeTexture() {},
    createTexture() { const texture = handle(); calls.created_textures.push(texture); return texture; },
    bindTexture(_target: number, texture: object | null) { calls.current_texture = texture; },
    texParameteri() {}, texImage2D(...args: unknown[]) { calls.uploaded_images.push(args.at(-1) as object); },
    getParameter: () => 4096, getError: () => 0,
    deleteTexture(texture: object) { calls.deleted_textures.push(texture); }, enable() {}, blendFunc() {},
    viewport() {}, clearColor() {}, clear() {}, useProgram() {}, uniform2f() {}, uniform1i() {},
    bufferData(_target: number, data: Float32Array) { calls.uploaded_vertices.push(data); },
    drawArrays() { if (calls.current_texture) calls.draw_textures.push(calls.current_texture); },
  } as unknown as WebGL2RenderingContext;
  return { gl, calls };
}

function installCanvasStub() {
  const original_document = globalThis.document;
  const canvases: object[] = [];
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: () => {
      const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
      canvases.push(canvas);
      return canvas;
    },
  } });
  return { canvases, restore: () => Object.defineProperty(globalThis, "document",
    { configurable: true, value: original_document }) };
}

function command(sprite: Sprite, batch?: string): SpriteDrawCommand {
  return { x: 0, y: 0, width: 10, height: 10, color: [1, 1, 1, 1], sprite,
    flipY: false, rotateCounterClockwise: false, rotationRadians: 0, batch };
}

test("uploads aliased gameplay sprites in one atlas texture", () => {
  const dom = installCanvasStub();
  const sprite = createSprite("shared");
  const fake = createGl();
  const canvas = { clientWidth: 100, clientHeight: 100, width: 0, height: 0,
    getContext: () => fake.gl } as unknown as HTMLCanvasElement;
  const graphics = new WebGlSpriteGraphics(canvas, { sprites: { first: sprite, alias: sprite } }, () => 1);

  assert.equal(fake.calls.created_textures.length, 1);
  assert.equal(fake.calls.uploaded_images[0], dom.canvases[0]);
  graphics.destroy();
  graphics.destroy();
  assert.equal(fake.calls.deleted_textures.length, 1);
  assert.equal(fake.calls.deleted_buffers, 1);
  assert.equal(fake.calls.deleted_vertex_arrays, 1);
  assert.equal(fake.calls.deleted_programs, 1);
  dom.restore();
});

test("rotates sprite geometry around its center by an arbitrary angle", () => {
  const dom = installCanvasStub();
  const sprite = createSprite("rotated");
  const fake = createGl();
  const canvas = { clientWidth: 100, clientHeight: 100, width: 0, height: 0,
    getContext: () => fake.gl } as unknown as HTMLCanvasElement;
  const graphics = new WebGlSpriteGraphics(canvas, { sprites: { sprite } }, () => 1);
  graphics.submit([{ ...command(sprite), x: 10, y: 20, width: 20, height: 10, rotationRadians: Math.PI / 2 }]);
  const vertices = fake.calls.uploaded_vertices.at(-1)!;
  assert.ok(Math.abs(vertices[0]! - 25) < 1e-9);
  assert.ok(Math.abs(vertices[1]! - 15) < 1e-9);
  assert.ok(Math.abs(vertices[8]! - 25) < 1e-9);
  assert.ok(Math.abs(vertices[9]! - 35) < 1e-9);
  dom.restore();
});

test("batches ordered sprite commands that share an atlas", () => {
  const dom = installCanvasStub();
  const first = createSprite("first");
  const second = createSprite("second");
  const fake = createGl();
  const canvas = { clientWidth: 100, clientHeight: 100, width: 0, height: 0,
    getContext: () => fake.gl } as unknown as HTMLCanvasElement;
  const graphics = new WebGlSpriteGraphics(canvas, { sprites: { first, second } }, () => 1);
  const [atlas_texture] = fake.calls.created_textures;

  graphics.submit([command(first), command(second), command(first, "notes"), command(second, "notes"),
    command(first, "notes"), command(second)]);

  assert.deepEqual(fake.calls.draw_textures, [atlas_texture]);
  assert.equal(fake.calls.uploaded_vertices[0]!.length, 6 * 6 * 8);
  const vertices = fake.calls.uploaded_vertices[0]!;
  assert.notEqual(vertices[2], vertices[6 * 8 + 2]);
  assert.equal(vertices[2], vertices[2 * 6 * 8 + 2]);
  dom.restore();
});

test("uses packed atlas UVs for gameplay sprites", () => {
  const dom = installCanvasStub();
  const sprite = createSprite("uv");
  const fake = createGl();
  const canvas = { clientWidth: 100, clientHeight: 100, width: 0, height: 0,
    getContext: () => fake.gl } as unknown as HTMLCanvasElement;
  const graphics = new WebGlSpriteGraphics(canvas, { sprites: { sprite } }, () => 1);

  graphics.submit([command(sprite)]);

  const vertices = fake.calls.uploaded_vertices[0]!;
  assert.ok(Math.abs(vertices[2]! - 2 / 14) < 1e-6);
  assert.ok(Math.abs(vertices[3]! - 2 / 14) < 1e-6);
  assert.ok(Math.abs(vertices[10]! - 12 / 14) < 1e-6);
  assert.ok(Math.abs(vertices[19]! - 12 / 14) < 1e-6);
  dom.restore();
});
