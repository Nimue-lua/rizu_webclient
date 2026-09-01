import { resizeGameplayCanvas, type GameplayFrame } from "./GameplayFrame";
import { createRuntimeTextureAtlases, packRuntimeTextureLayout } from "./RuntimeTexturePacker";
import type { Sprite, SpriteDrawCommand, SpriteSkin } from "./Sprite";

const BACKGROUND_COLOR = [0, 0, 0, 0] as const;
const VERTEX_FLOATS = 8;
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
  private draw_calls = 0;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, skin: SpriteSkin,
    device_pixel_ratio: () => number = () => window.devicePixelRatio) {
    const gl = canvas.getContext("webgl2");
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
      this.submitBatch(uploaded.texture, commands.slice(start, end));
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

  private submitBatch(texture: WebGLTexture, commands: readonly SpriteDrawCommand[]): void {
    const vertices: number[] = [];
    for (const command of commands) {
      if (command.width <= 0 || command.height <= 0) continue;
      const uploaded = this.sprites.get(command.sprite);
      if (!uploaded) throw new Error("Gameplay sprite texture was not uploaded");
      if (command.circularProgress !== undefined) {
        this.addCircularProgressVertices(vertices, command, uploaded);
        continue;
      }
      let top_left = [uploaded.u0, command.flipY ? uploaded.v1 : uploaded.v0];
      let top_right = [uploaded.u1, command.flipY ? uploaded.v1 : uploaded.v0];
      let bottom_left = [uploaded.u0, command.flipY ? uploaded.v0 : uploaded.v1];
      let bottom_right = [uploaded.u1, command.flipY ? uploaded.v0 : uploaded.v1];
      if (command.rotateCounterClockwise) {
        [top_left, top_right, bottom_left, bottom_right] = [top_right, bottom_right, top_left, bottom_left];
      }
      const center_x = command.x + command.width / 2;
      const center_y = command.y + command.height / 2;
      const cosine = Math.cos(command.rotationRadians);
      const sine = Math.sin(command.rotationRadians);
      const corners = [[command.x, command.y, ...top_left],
        [command.x + command.width, command.y, ...top_right], [command.x, command.y + command.height, ...bottom_left],
        [command.x, command.y + command.height, ...bottom_left], [command.x + command.width, command.y, ...top_right],
        [command.x + command.width, command.y + command.height, ...bottom_right]];
      for (const [px, py, u, v] of corners) {
        const dx = px! - center_x;
        const dy = py! - center_y;
        vertices.push(center_x + dx * cosine - dy * sine, center_y + dx * sine + dy * cosine,
          u!, v!, ...command.color);
      }
    }
    if (vertices.length === 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertex_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / VERTEX_FLOATS);
    this.draw_calls += 1;
  }

  get drawCallCount(): number { return this.draw_calls; }

  private addCircularProgressVertices(vertices: number[], command: SpriteDrawCommand, uploaded: UploadedSprite): void {
    const progress = Math.max(-1, Math.min(1, command.circularProgress ?? 0));
    if (progress === 0) return;
    const center_x = command.x + command.width / 2;
    const center_y = command.y + command.height / 2;
    const radius = Math.min(command.width, command.height) / 2;
    const start_angle = -Math.PI / 2;
    const end_angle = start_angle + progress * Math.PI * 2;
    const angle_min = Math.min(start_angle, end_angle);
    const angle_max = Math.max(start_angle, end_angle);
    const segments = 40;
    const step = Math.PI * 2 / segments;
    const color = command.color;
    const vertex = (x: number, y: number) => vertices.push(x, y,
      uploaded.u0 + (x - command.x) / command.width * (uploaded.u1 - uploaded.u0),
      uploaded.v0 + (y - command.y) / command.height * (uploaded.v1 - uploaded.v0), ...color);
    for (let angle = angle_min; angle < angle_max;) {
      const next = Math.min(angle + step, angle_max);
      vertex(center_x, center_y);
      vertex(center_x + Math.cos(angle) * radius, center_y + Math.sin(angle) * radius);
      vertex(center_x + Math.cos(next) * radius, center_y + Math.sin(next) * radius);
      angle = next;
    }
  }
}
