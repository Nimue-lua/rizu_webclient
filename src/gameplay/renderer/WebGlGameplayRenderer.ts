import type { VisualNote } from "../RhythmEngine";
import { ManiaPlayfieldRenderer } from "./ManiaPlayfieldRenderer";
import { NOTE_SKIN_LOGICAL_HEIGHT, type NoteSkin, type NoteSkinFrame } from "./NoteSkin";

const BACKGROUND_COLOR = [0.035, 0.035, 0.045, 1] as const;
const VERTEX_FLOATS = 8;

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
void main() { color = tint * texture(atlas, uv); }`;

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

export class WebGlGameplayRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly skin: NoteSkin;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vertex_array: WebGLVertexArrayObject;
  private readonly vertex_buffer: WebGLBuffer;
  private readonly viewport_size: WebGLUniformLocation;
  private readonly texture: WebGLTexture;
  private readonly playfield: ManiaPlayfieldRenderer;
  private vertices: number[] = [];

  constructor(canvas: HTMLCanvasElement, skin: NoteSkin) {
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL 2 is required for gameplay");
    const program = createProgram(gl);
    const vertex_array = gl.createVertexArray();
    const vertex_buffer = gl.createBuffer();
    const viewport_size = gl.getUniformLocation(program, "viewport_size");
    const texture = gl.createTexture();
    if (!vertex_array || !vertex_buffer || !viewport_size || !texture) throw new Error("Failed to create gameplay rendering resources");
    this.canvas = canvas;
    this.skin = skin;
    this.gl = gl;
    this.program = program;
    this.vertex_array = vertex_array;
    this.vertex_buffer = vertex_buffer;
    this.viewport_size = viewport_size;
    this.texture = texture;
    this.playfield = new ManiaPlayfieldRenderer(skin);
    gl.bindVertexArray(vertex_array);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
    const stride = VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
    for (const [name, size, offset] of [["position", 2, 0], ["texture_position", 2, 2], ["vertex_color", 4, 4]] as const) {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * Float32Array.BYTES_PER_ELEMENT);
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, skin.image);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  get comboPosition(): number { return this.playfield.comboPosition; }
  get judgePosition(): number { return this.playfield.judgePosition; }

  getTimeRange(column_count: number, scroll_speed: number): { past: number; future: number } {
    if (column_count !== this.skin.config.columnCount) throw new Error("Chart and skin column counts do not match");
    return this.playfield.getTimeRange(this.playfield.getLayout(this.logicalWidth()), scroll_speed);
  }

  draw(column_count: number, notes: readonly VisualNote[], scroll_speed: number,
    pressed_columns: ArrayLike<number> = []): void {
    if (column_count !== this.skin.config.columnCount) throw new Error("Chart and skin column counts do not match");
    const framebuffer = this.resizeCanvas();
    const layout = this.playfield.getLayout(NOTE_SKIN_LOGICAL_HEIGHT * framebuffer.width / framebuffer.height);
    const gl = this.gl;
    gl.viewport(0, 0, framebuffer.width, framebuffer.height);
    gl.clearColor(...BACKGROUND_COLOR);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertex_array);
    gl.uniform2f(this.viewport_size, layout.width, layout.height);
    this.vertices = [];
    this.playfield.draw(layout, notes, scroll_speed, pressed_columns,
      (x, y, width, height, color, frame) => this.addQuad(x, y, width, height, color, frame));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertex_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.vertices), gl.DYNAMIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertices.length / VERTEX_FLOATS);
  }

  destroy(): void {
    this.gl.deleteTexture(this.texture);
    this.gl.deleteBuffer(this.vertex_buffer);
    this.gl.deleteVertexArray(this.vertex_array);
    this.gl.deleteProgram(this.program);
  }

  private addQuad(x: number, y: number, width: number, height: number,
    color: readonly [number, number, number, number], frame: NoteSkinFrame): void {
    if (width <= 0 || height <= 0) return;
    const image = this.skin.image;
    const u0 = frame.frame.x / image.width;
    const v0 = frame.frame.y / image.height;
    const u1 = (frame.frame.x + frame.frame.w) / image.width;
    const v1 = (frame.frame.y + frame.frame.h) / image.height;
    for (const [px, py, u, v] of [[x, y, u0, v0], [x + width, y, u1, v0], [x, y + height, u0, v1],
      [x, y + height, u0, v1], [x + width, y, u1, v0], [x + width, y + height, u1, v1]]) {
      this.vertices.push(px, py, u, v, ...color);
    }
  }

  private resizeCanvas(): { width: number; height: number } {
    const ratio = window.devicePixelRatio;
    const framebuffer_width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const framebuffer_height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== framebuffer_width || this.canvas.height !== framebuffer_height) {
      this.canvas.width = framebuffer_width;
      this.canvas.height = framebuffer_height;
    }
    return { width: framebuffer_width, height: framebuffer_height };
  }

  private logicalWidth(): number {
    const framebuffer = this.resizeCanvas();
    return NOTE_SKIN_LOGICAL_HEIGHT * framebuffer.width / framebuffer.height;
  }
}
