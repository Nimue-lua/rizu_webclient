import type { VisualNote } from "../RhythmEngine";
import { default_note_skin, type NoteSkin } from "./NoteSkin";

const CIRCLE_SEGMENTS = 48;

const vertex_shader_source = `#version 300 es
in vec2 position;
uniform vec2 center;
uniform vec2 viewport_size;
uniform float radius;
void main() {
  vec2 pixel_position = center + position * radius;
  vec2 clip_position = vec2(pixel_position.x / viewport_size.x * 2.0 - 1.0, 1.0 - pixel_position.y / viewport_size.y * 2.0);
  gl_Position = vec4(clip_position, 0.0, 1.0);
}`;

const fragment_shader_source = `#version 300 es
precision highp float;
uniform vec4 shape_color;
out vec4 color;
void main() { color = shape_color; }`;

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

function createGeometry(): { circle_count: number; ring_offset: number; ring_count: number; vertices: Float32Array } {
  const vertices: number[] = [0, 0];
  for (let index = 0; index <= CIRCLE_SEGMENTS; index += 1) {
    const angle = (index / CIRCLE_SEGMENTS) * Math.PI * 2;
    vertices.push(Math.cos(angle), Math.sin(angle));
  }
  const circle_count = vertices.length / 2;
  for (let index = 0; index <= CIRCLE_SEGMENTS; index += 1) {
    const angle = (index / CIRCLE_SEGMENTS) * Math.PI * 2;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    vertices.push(x, y, x * 0.82, y * 0.82);
  }
  return { circle_count, ring_offset: circle_count, ring_count: (CIRCLE_SEGMENTS + 1) * 2, vertices: new Float32Array(vertices) };
}

export class WebGlGameplayRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly skin: NoteSkin;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vertex_array: WebGLVertexArrayObject;
  private readonly vertex_buffer: WebGLBuffer;
  private readonly center: WebGLUniformLocation;
  private readonly viewport_size: WebGLUniformLocation;
  private readonly radius: WebGLUniformLocation;
  private readonly shape_color: WebGLUniformLocation;
  private readonly geometry = createGeometry();

  constructor(canvas: HTMLCanvasElement, skin: NoteSkin = default_note_skin) {
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL 2 is required for gameplay");
    const program = createProgram(gl);
    const vertex_array = gl.createVertexArray();
    const vertex_buffer = gl.createBuffer();
    const center = gl.getUniformLocation(program, "center");
    const viewport_size = gl.getUniformLocation(program, "viewport_size");
    const radius = gl.getUniformLocation(program, "radius");
    const shape_color = gl.getUniformLocation(program, "shape_color");
    if (!vertex_array || !vertex_buffer || !center || !viewport_size || !radius || !shape_color) {
      gl.deleteProgram(program);
      throw new Error("Failed to create gameplay rendering resources");
    }
    this.canvas = canvas;
    this.skin = skin;
    this.gl = gl;
    this.program = program;
    this.vertex_array = vertex_array;
    this.vertex_buffer = vertex_buffer;
    this.center = center;
    this.viewport_size = viewport_size;
    this.radius = radius;
    this.shape_color = shape_color;
    gl.bindVertexArray(vertex_array);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.geometry.vertices, gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  }

  getTimeRange(column_count: number, scroll_speed: number): { past: number; future: number } {
    const layout = this.getLayout(column_count);
    const pixels_per_ms = scroll_speed / 1000;
    return {
      future: (layout.receptor_y + layout.note_radius) / pixels_per_ms,
      past: (layout.height + layout.note_radius - layout.receptor_y) / pixels_per_ms,
    };
  }

  draw(column_count: number, notes: readonly VisualNote[], scroll_speed: number): void {
    const layout = this.getLayout(column_count);
    const pixels_per_ms = scroll_speed / 1000;
    const background = this.skin.background_color;
    this.gl.viewport(0, 0, layout.framebuffer_width, layout.framebuffer_height);
    this.gl.clearColor(...background);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.gl.useProgram(this.program);
    this.gl.bindVertexArray(this.vertex_array);
    this.gl.uniform2f(this.viewport_size, layout.width, layout.height);
    this.setColor(this.skin.receptor_color);
    for (let column = 0; column < column_count; column += 1) {
      this.drawRing(layout.playfield_left + layout.note_radius + layout.column_width * column, layout.receptor_y, layout.note_radius);
    }
    this.setColor(this.skin.note_color);
    for (const note of notes) {
      const x = layout.playfield_left + layout.note_radius + layout.column_width * (note.column - 1);
      const y = layout.receptor_y - note.start_dt * pixels_per_ms;
      this.drawCircle(x, y, layout.note_radius);
    }
  }

  destroy(): void {
    this.gl.deleteBuffer(this.vertex_buffer);
    this.gl.deleteVertexArray(this.vertex_array);
    this.gl.deleteProgram(this.program);
  }

  private getLayout(column_count: number) {
    const device_pixel_ratio = window.devicePixelRatio;
    const framebuffer_width = Math.max(1, Math.round(this.canvas.clientWidth * device_pixel_ratio));
    const framebuffer_height = Math.max(1, Math.round(this.canvas.clientHeight * device_pixel_ratio));
    if (this.canvas.width !== framebuffer_width || this.canvas.height !== framebuffer_height) {
      this.canvas.width = framebuffer_width;
      this.canvas.height = framebuffer_height;
    }
    const height = this.skin.logical_height;
    const width = height * framebuffer_width / framebuffer_height;
    const gap = this.skin.column_gap;
    const note_radius = Math.min(this.skin.max_note_radius, (width - gap * (column_count - 1)) / (column_count * 2));
    const column_width = note_radius * 2 + gap;
    const playfield_width = note_radius * 2 * column_count + gap * (column_count - 1);
    return {
      width, height, framebuffer_width, framebuffer_height, note_radius, column_width,
      playfield_left: (width - playfield_width) / 2,
      receptor_y: height - this.skin.receptor_bottom_margin,
    };
  }

  private setColor(color: readonly [number, number, number, number]): void {
    this.gl.uniform4f(this.shape_color, ...color);
  }

  private drawCircle(x: number, y: number, radius: number): void {
    this.gl.uniform2f(this.center, x, y);
    this.gl.uniform1f(this.radius, radius);
    this.gl.drawArrays(this.gl.TRIANGLE_FAN, 0, this.geometry.circle_count);
  }

  private drawRing(x: number, y: number, radius: number): void {
    this.gl.uniform2f(this.center, x, y);
    this.gl.uniform1f(this.radius, radius);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, this.geometry.ring_offset, this.geometry.ring_count);
  }
}
