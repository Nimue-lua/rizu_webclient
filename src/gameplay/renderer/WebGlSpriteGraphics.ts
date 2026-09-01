import { resizeGameplayCanvas, type GameplayFrame } from "./GameplayFrame";
import { createRuntimeTextureAtlases, packRuntimeTextureLayout } from "./RuntimeTexturePacker";
import type { Sprite, SpriteDrawCommand, SpriteSkin } from "./Sprite";

const BACKGROUND_COLOR = [0, 0, 0, 0] as const;
const VERTEX_FLOATS = 8;
const QUAD_VERTICES = 6;
const INITIAL_VERTEX_FLOAT_CAPACITY = VERTEX_FLOATS * QUAD_VERTICES * 64;
const MAX_ATLAS_SIZE = 4096;

interface UploadedSprite {
  texture: WebGLTexture;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

const vertex_shader_source = `#version 300 es
in vec2 position;
in vec2 texture_position;
in vec4 vertex_color;
uniform vec2 viewport_size;
out vec2 uv;
out vec4 tint;
void main() {
  gl_Position = vec4(position.x / viewport_size.x * 2.0 - 1.0, 1.0 - position.y / viewport_size.y * 2.0, 0.0, 1.0);
  uv = texture_position;
  tint = vertex_color;
}`;

const fragment_shader_source = `#version 300 es
precision highp float;
uniform sampler2D atlas;
in vec2 uv;
in vec4 tint;
out vec4 color;
void main() {
  vec4 sampled = texture(atlas, uv);
  color = vec4(sampled.rgb * tint.rgb * tint.a, sampled.a * tint.a);
}`;

function createShader(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create WebGL shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unknown shader compilation error";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertex_shader = createShader(gl, gl.VERTEX_SHADER, vertex_shader_source);
  const fragment_shader = createShader(gl, gl.FRAGMENT_SHADER, fragment_shader_source);
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create WebGL program");
  gl.attachShader(program, vertex_shader);
  gl.attachShader(program, fragment_shader);
  gl.linkProgram(program);
  gl.deleteShader(vertex_shader);
  gl.deleteShader(fragment_shader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Unknown program linking error";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

export class WebGlSpriteGraphics {
  private readonly canvas: HTMLCanvasElement;
  private readonly device_pixel_ratio: () => number;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vertex_array: WebGLVertexArrayObject;
  private readonly vertex_buffer: WebGLBuffer;
  private readonly viewport_size: WebGLUniformLocation;
  private readonly sampler: WebGLUniformLocation;
  private readonly sprites = new Map<Sprite, UploadedSprite>();
  private readonly textures: WebGLTexture[] = [];
  private vertex_staging = new Float32Array(INITIAL_VERTEX_FLOAT_CAPACITY);
  private vertex_buffer_capacity = 0;
  private draw_calls = 0;
  private command_count = 0;
  private vertex_count = 0;
  private buffer_upload_count = 0;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, skin: SpriteSkin,
    device_pixel_ratio: () => number = () => window.devicePixelRatio) {
    const gl = canvas.getContext("webgl2", { stencil: true });
    if (!gl) throw new Error("WebGL 2 is required for gameplay");
    const program = createProgram(gl);
    const vertex_array = gl.createVertexArray();
    const vertex_buffer = gl.createBuffer();
    const viewport_size = gl.getUniformLocation(program, "viewport_size");
    const sampler = gl.getUniformLocation(program, "atlas");
    if (!vertex_array || !vertex_buffer || !viewport_size || !sampler) {
      gl.deleteBuffer(vertex_buffer);
      gl.deleteVertexArray(vertex_array);
      gl.deleteProgram(program);
      throw new Error("Failed to create gameplay rendering resources");
    }
    this.canvas = canvas;
    this.device_pixel_ratio = device_pixel_ratio;
    this.gl = gl;
    this.program = program;
    this.vertex_array = vertex_array;
    this.vertex_buffer = vertex_buffer;
    this.viewport_size = viewport_size;
    this.sampler = sampler;
    gl.bindVertexArray(vertex_array);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
    const stride = VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
    for (const [name, size, offset] of [["position", 2, 0], ["texture_position", 2, 2], ["vertex_color", 4, 4]] as const) {
      const location = gl.getAttribLocation(program, name);
      if (location < 0) throw new Error(`Gameplay sprite shader is missing ${name}`);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * Float32Array.BYTES_PER_ELEMENT);
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.activeTexture(gl.TEXTURE0);
    const sources = [...new Set(Object.values(skin.sprites))].map((sprite) => ({ value: sprite, image: sprite.image }));
    const hardware_max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const max_size = Math.min(MAX_ATLAS_SIZE, hardware_max);
    const layout = packRuntimeTextureLayout(sources, { maxWidth: max_size, maxHeight: max_size,
      extrusion: 1, padding: 1 });
    const atlases = createRuntimeTextureAtlases(layout);
    for (const atlas of atlases) {
      const texture = gl.createTexture();
      if (!texture) throw new Error("Failed to create gameplay sprite atlas texture");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) {
        gl.deleteTexture(texture);
        throw new Error(`Failed to upload sprite atlas (${atlas.width}x${atlas.height}): WebGL error 0x${error.toString(16)}`);
      }
      this.textures.push(texture);
      for (const entry of atlas.entries) {
        this.sprites.set(entry.value, { texture, u0: entry.x / atlas.width, v0: entry.y / atlas.height,
          u1: (entry.x + entry.width) / atlas.width, v1: (entry.y + entry.height) / atlas.height });
      }
    }
    for (const source of layout.standalone) {
      const texture = gl.createTexture();
      if (!texture) throw new Error("Failed to create gameplay sprite texture");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source.image);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) {
        gl.deleteTexture(texture);
        throw new Error(`Failed to upload sprite (${source.image.width}x${source.image.height}): WebGL error 0x${error.toString(16)}`);
      }
      this.textures.push(texture);
      this.sprites.set(source.value, { texture, u0: 0, v0: 0, u1: 1, v1: 1 });
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  getFrame(): GameplayFrame {
    return resizeGameplayCanvas(this.canvas, this.device_pixel_ratio());
  }

  beginFrame(frame: GameplayFrame): void {
    const gl = this.gl;
    this.draw_calls = 0;
    this.command_count = 0;
    this.vertex_count = 0;
    this.buffer_upload_count = 0;
    gl.viewport(0, 0, frame.framebuffer_width, frame.framebuffer_height);
    gl.clearColor(...BACKGROUND_COLOR);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertex_array);
    gl.uniform2f(this.viewport_size, frame.logical_width, frame.logical_height);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.sampler, 0);
  }

  submit(commands: readonly SpriteDrawCommand[]): void {
    const gl = this.gl;
    this.command_count += commands.length;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertex_array);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.sampler, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (let start = 0; start < commands.length;) {
      const uploaded = this.sprites.get(commands[start]!.sprite);
      if (!uploaded) throw new Error("Gameplay sprite texture was not uploaded");
      let end = start + 1;
      while (end < commands.length && this.sprites.get(commands[end]!.sprite)?.texture === uploaded.texture) end += 1;
      this.submitBatch(uploaded.texture, commands, start, end);
      start = end;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    this.gl.deleteBuffer(this.vertex_buffer);
    this.gl.deleteVertexArray(this.vertex_array);
    this.gl.deleteProgram(this.program);
  }

  private submitBatch(texture: WebGLTexture, commands: readonly SpriteDrawCommand[], start: number, end: number): void {
    let float_count = 0;
    for (let index = start; index < end; index += 1) {
      const command = commands[index]!;
      if (command.width <= 0 || command.height <= 0) continue;
      const uploaded = this.sprites.get(command.sprite);
      if (!uploaded) throw new Error("Gameplay sprite texture was not uploaded");
      if (command.circularProgress !== undefined) {
        float_count = this.addCircularProgressVertices(float_count, command, uploaded);
        continue;
      }
      this.ensureVertexCapacity(float_count + VERTEX_FLOATS * QUAD_VERTICES);
      float_count = command.rotationRadians === 0
        ? this.addAxisAlignedQuad(float_count, command, uploaded)
        : this.addRotatedQuad(float_count, command, uploaded);
    }
    if (float_count === 0) return;
    const gl = this.gl;
    const byte_count = float_count * Float32Array.BYTES_PER_ELEMENT;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertex_buffer);
    if (byte_count > this.vertex_buffer_capacity) {
      this.vertex_buffer_capacity = this.vertex_staging.byteLength;
      gl.bufferData(gl.ARRAY_BUFFER, this.vertex_buffer_capacity, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertex_staging, 0, float_count);
    this.buffer_upload_count += 1;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.drawArrays(gl.TRIANGLES, 0, float_count / VERTEX_FLOATS);
    this.draw_calls += 1;
    this.vertex_count += float_count / VERTEX_FLOATS;
  }

  private addAxisAlignedQuad(offset: number, command: SpriteDrawCommand, uploaded: UploadedSprite): number {
    const top_v = command.flipY ? uploaded.v1 : uploaded.v0;
    const bottom_v = command.flipY ? uploaded.v0 : uploaded.v1;
    const top_left_u = command.rotateCounterClockwise ? uploaded.u1 : uploaded.u0;
    const top_right_v = command.rotateCounterClockwise ? bottom_v : top_v;
    const bottom_left_v = command.rotateCounterClockwise ? top_v : bottom_v;
    const bottom_right_u = command.rotateCounterClockwise ? uploaded.u0 : uploaded.u1;
    const left = command.x;
    const top = command.y;
    const right = left + command.width;
    const bottom = top + command.height;
    offset = this.addVertex(offset, left, top, top_left_u, top_v, command.color);
    offset = this.addVertex(offset, right, top, uploaded.u1, top_right_v, command.color);
    offset = this.addVertex(offset, left, bottom, uploaded.u0, bottom_left_v, command.color);
    offset = this.addVertex(offset, left, bottom, uploaded.u0, bottom_left_v, command.color);
    offset = this.addVertex(offset, right, top, uploaded.u1, top_right_v, command.color);
    return this.addVertex(offset, right, bottom, bottom_right_u, bottom_v, command.color);
  }

  private addRotatedQuad(offset: number, command: SpriteDrawCommand, uploaded: UploadedSprite): number {
    const top_v = command.flipY ? uploaded.v1 : uploaded.v0;
    const bottom_v = command.flipY ? uploaded.v0 : uploaded.v1;
    const top_left_u = command.rotateCounterClockwise ? uploaded.u1 : uploaded.u0;
    const top_right_u = uploaded.u1;
    const top_right_v = command.rotateCounterClockwise ? bottom_v : top_v;
    const bottom_left_u = uploaded.u0;
    const bottom_left_v = command.rotateCounterClockwise ? top_v : bottom_v;
    const bottom_right_u = command.rotateCounterClockwise ? uploaded.u0 : uploaded.u1;
    const center_x = command.x + command.width / 2;
    const center_y = command.y + command.height / 2;
    const cosine = Math.cos(command.rotationRadians);
    const sine = Math.sin(command.rotationRadians);
    const half_width = command.width / 2;
    const half_height = command.height / 2;
    const left_x = center_x - half_width * cosine + half_height * sine;
    const left_y = center_y - half_width * sine - half_height * cosine;
    const top_x = center_x + half_width * cosine + half_height * sine;
    const top_y = center_y + half_width * sine - half_height * cosine;
    const bottom_x = center_x - half_width * cosine - half_height * sine;
    const bottom_y = center_y - half_width * sine + half_height * cosine;
    const right_x = center_x + half_width * cosine - half_height * sine;
    const right_y = center_y + half_width * sine + half_height * cosine;
    offset = this.addVertex(offset, left_x, left_y, top_left_u, top_v, command.color);
    offset = this.addVertex(offset, top_x, top_y, top_right_u, top_right_v, command.color);
    offset = this.addVertex(offset, bottom_x, bottom_y, bottom_left_u, bottom_left_v, command.color);
    offset = this.addVertex(offset, bottom_x, bottom_y, bottom_left_u, bottom_left_v, command.color);
    offset = this.addVertex(offset, top_x, top_y, top_right_u, top_right_v, command.color);
    return this.addVertex(offset, right_x, right_y, bottom_right_u, bottom_v, command.color);
  }

  private addVertex(offset: number, x: number, y: number, u: number, v: number,
    color: readonly [number, number, number, number]): number {
    const vertices = this.vertex_staging;
    vertices[offset] = x;
    vertices[offset + 1] = y;
    vertices[offset + 2] = u;
    vertices[offset + 3] = v;
    vertices[offset + 4] = color[0];
    vertices[offset + 5] = color[1];
    vertices[offset + 6] = color[2];
    vertices[offset + 7] = color[3];
    return offset + VERTEX_FLOATS;
  }

  private ensureVertexCapacity(required: number): void {
    if (required <= this.vertex_staging.length) return;
    const capacity = this.grownCapacity(this.vertex_staging.length, required);
    const staging = new Float32Array(capacity);
    staging.set(this.vertex_staging);
    this.vertex_staging = staging;
  }

  private grownCapacity(current: number, required: number): number {
    let capacity = Math.max(1, current);
    while (capacity < required) capacity *= 2;
    return capacity;
  }

  get drawCallCount(): number { return this.draw_calls; }
  get commandCount(): number { return this.command_count; }
  get vertexCount(): number { return this.vertex_count; }
  get bufferUploadCount(): number { return this.buffer_upload_count; }

  private addCircularProgressVertices(offset: number, command: SpriteDrawCommand, uploaded: UploadedSprite): number {
    const progress = Math.max(-1, Math.min(1, command.circularProgress ?? 0));
    if (progress === 0) return offset;
    const center_x = command.x + command.width / 2;
    const center_y = command.y + command.height / 2;
    const radius = Math.min(command.width, command.height) / 2;
    const start_angle = -Math.PI / 2;
    const end_angle = start_angle + progress * Math.PI * 2;
    const angle_min = Math.min(start_angle, end_angle);
    const angle_max = Math.max(start_angle, end_angle);
    const segments = 40;
    const step = Math.PI * 2 / segments;
    this.ensureVertexCapacity(offset + Math.ceil(Math.abs(progress) * segments) * 3 * VERTEX_FLOATS);
    for (let angle = angle_min; angle < angle_max;) {
      const next = Math.min(angle + step, angle_max);
      offset = this.addCircularProgressVertex(offset, center_x, center_y, command, uploaded);
      offset = this.addCircularProgressVertex(offset, center_x + Math.cos(angle) * radius,
        center_y + Math.sin(angle) * radius, command, uploaded);
      offset = this.addCircularProgressVertex(offset, center_x + Math.cos(next) * radius,
        center_y + Math.sin(next) * radius, command, uploaded);
      angle = next;
    }
    return offset;
  }

  private addCircularProgressVertex(offset: number, x: number, y: number, command: SpriteDrawCommand,
    uploaded: UploadedSprite): number {
    return this.addVertex(offset, x, y,
      uploaded.u0 + (x - command.x) / command.width * (uploaded.u1 - uploaded.u0),
      uploaded.v0 + (y - command.y) / command.height * (uploaded.v1 - uploaded.v0), command.color);
  }
}
