import { NoteState, type VisualNote } from "../RhythmEngine";
import { NOTE_SKIN_LOGICAL_HEIGHT, type NoteSkin, type NoteSkinFrame } from "./NoteSkin";

const BACKGROUND_COLOR = [0.035, 0.035, 0.045, 1] as const;
const RECEPTOR_COLOR = [0.3, 0.75, 1, 1] as const;
const NOTE_COLOR = [1, 1, 1, 1] as const;
const LONG_NOTE_COLOR = [0.65, 0.85, 1, 0.8] as const;
const FALLBACK_COLUMN_GAP = 2;
const FALLBACK_COLUMN_WIDTH = 60;
const FALLBACK_HIT_POSITION = 420;
const VERTEX_FLOATS = 8;

export function getLongNoteBrightness(state: NoteState): number {
  if (state === NoteState.StartMissedPressed) return 0.75;
  if (state === NoteState.StartMissed || state === NoteState.EndMissed || state === NoteState.EndMissedPassed) return 0.5;
  return 1;
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
uniform bool textured;
in vec2 uv;
in vec4 tint;
out vec4 color;
void main() { color = tint * (textured ? texture(atlas, uv) : vec4(1.0)); }`;

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

interface Layout {
  width: number;
  height: number;
  framebuffer_width: number;
  framebuffer_height: number;
  column_left: readonly number[];
  column_width: readonly number[];
  playfield_left: number;
  receptor_y: number;
}

export class WebGlGameplayRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly skin?: NoteSkin;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vertex_array: WebGLVertexArrayObject;
  private readonly vertex_buffer: WebGLBuffer;
  private readonly viewport_size: WebGLUniformLocation;
  private readonly textured: WebGLUniformLocation;
  private readonly texture?: WebGLTexture;
  private vertices: number[] = [];

  constructor(canvas: HTMLCanvasElement, skin?: NoteSkin) {
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL 2 is required for gameplay");
    const program = createProgram(gl);
    const vertex_array = gl.createVertexArray();
    const vertex_buffer = gl.createBuffer();
    const viewport_size = gl.getUniformLocation(program, "viewport_size");
    const textured = gl.getUniformLocation(program, "textured");
    if (!vertex_array || !vertex_buffer || !viewport_size || !textured) throw new Error("Failed to create gameplay rendering resources");
    this.canvas = canvas;
    this.skin = skin;
    this.gl = gl;
    this.program = program;
    this.vertex_array = vertex_array;
    this.vertex_buffer = vertex_buffer;
    this.viewport_size = viewport_size;
    this.textured = textured;
    gl.bindVertexArray(vertex_array);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
    const stride = VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
    for (const [name, size, offset] of [["position", 2, 0], ["texture_position", 2, 2], ["vertex_color", 4, 4]] as const) {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * Float32Array.BYTES_PER_ELEMENT);
    }
    if (skin) {
      const texture = gl.createTexture();
      if (!texture) throw new Error("Failed to create skin texture");
      this.texture = texture;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, skin.image);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  get comboPosition(): number | undefined { return this.skin?.config.comboPosition; }
  get judgePosition(): number | undefined { return this.skin?.config.judgePosition; }

  getTimeRange(column_count: number, scroll_speed: number): { past: number; future: number } {
    const layout = this.getLayout(column_count);
    const seconds_per_pixel = 1 / (NOTE_SKIN_LOGICAL_HEIGHT * scroll_speed);
    const margin = Math.max(...layout.column_width);
    return { future: (layout.receptor_y + margin) * seconds_per_pixel, past: (layout.height + margin - layout.receptor_y) * seconds_per_pixel };
  }

  draw(column_count: number, notes: readonly VisualNote[], scroll_speed: number,
    pressed_columns: ArrayLike<number> = []): void {
    const layout = this.getLayout(column_count);
    const pixels_per_visual_second = NOTE_SKIN_LOGICAL_HEIGHT * scroll_speed;
    const gl = this.gl;
    gl.viewport(0, 0, layout.framebuffer_width, layout.framebuffer_height);
    gl.clearColor(...BACKGROUND_COLOR);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertex_array);
    gl.uniform2f(this.viewport_size, layout.width, layout.height);
    this.vertices = [];
    if (this.skin) this.drawSkinned(layout, notes, pixels_per_visual_second, pressed_columns);
    else this.drawFallback(layout, notes, pixels_per_visual_second, pressed_columns);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertex_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.vertices), gl.DYNAMIC_DRAW);
    gl.uniform1i(this.textured, this.skin ? 1 : 0);
    if (this.texture) gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertices.length / VERTEX_FLOATS);
  }

  destroy(): void {
    if (this.texture) this.gl.deleteTexture(this.texture);
    this.gl.deleteBuffer(this.vertex_buffer);
    this.gl.deleteVertexArray(this.vertex_array);
    this.gl.deleteProgram(this.program);
  }

  private drawSkinned(layout: Layout, notes: readonly VisualNote[], speed: number,
    pressed_columns: ArrayLike<number>): void {
    const skin = this.skin!;
    for (let column = 0; column < skin.config.columnCount; column += 1) {
      const receptors = pressed_columns[column] ? skin.config.receptorPressed : skin.config.receptorReleased;
      this.addSprite(receptors?.[column], column, layout, layout.receptor_y);
    }
    for (const note of notes) {
      if (note.end_dt === undefined) continue;
      const column = note.column - 1;
      const head_y = Math.min(layout.receptor_y, layout.receptor_y - note.start_dt * speed);
      const tail_y = Math.min(layout.receptor_y, layout.receptor_y - note.end_dt * speed);
      const head_height = this.getSpriteHeight(skin.config.longNoteHeads?.[column], column, layout);
      const brightness = getLongNoteBrightness(note.state);
      this.addSprite(skin.config.longNoteBodies?.[column], column, layout, tail_y,
        Math.max(0, head_y + head_height * 0.5 - tail_y), brightness, true);
    }
    for (const note of notes) {
      if (note.end_dt === undefined) continue;
      const column = note.column - 1;
      const tail_y = Math.min(layout.receptor_y, layout.receptor_y - note.end_dt * speed);
      this.addSprite(skin.config.longNoteTails?.[column], column, layout, tail_y, undefined,
        getLongNoteBrightness(note.state), false, 1);
    }
    for (const note of notes) {
      const column = note.column - 1;
      const y = layout.receptor_y - note.start_dt * speed;
      const sprites = note.end_dt === undefined ? skin.config.shortNotes : skin.config.longNoteHeads;
      this.addSprite(sprites?.[column], column, layout, y, undefined,
        note.end_dt === undefined ? 1 : getLongNoteBrightness(note.state));
    }
  }

  private addSprite(name: string | undefined, column: number, layout: Layout, y: number, height?: number,
    brightness = 1, stretch = false, origin_y = 0): void {
    if (!name || !this.skin) return;
    const frame = this.skin.frames[name];
    if (!frame) return;
    const scale = layout.column_width[column]! / frame.sourceSize.w;
    const draw_height = height ?? frame.sourceSize.h * scale;
    if (draw_height <= 0) return;
    const x = layout.playfield_left + layout.column_left[column]! + frame.spriteSourceSize.x * scale;
    const top = stretch ? y : y - frame.sourceSize.h * scale * origin_y + frame.spriteSourceSize.y * scale;
    const width = frame.spriteSourceSize.w * scale;
    const visible_height = stretch ? draw_height : frame.spriteSourceSize.h * scale;
    this.addQuad(x, top, width, visible_height, [brightness, brightness, brightness, 1], frame);
  }

  private getSpriteHeight(name: string | undefined, column: number, layout: Layout): number {
    const frame = name ? this.skin?.frames[name] : undefined;
    return frame ? frame.sourceSize.h * layout.column_width[column]! / frame.sourceSize.w : 0;
  }

  private drawFallback(layout: Layout, notes: readonly VisualNote[], speed: number,
    pressed_columns: ArrayLike<number>): void {
    for (let column = 0; column < layout.column_width.length; column += 1) {
      const x = layout.playfield_left + layout.column_left[column]!;
      const height = Math.min(20, layout.column_width[column]! * 0.4);
      if (pressed_columns[column]) this.addQuad(x + 2, layout.receptor_y, layout.column_width[column]! - 4, height, RECEPTOR_COLOR);
      this.addFrame(x + 2, layout.receptor_y, layout.column_width[column]! - 4, height, RECEPTOR_COLOR, 3);
    }
    for (const note of notes) {
      if (note.end_dt === undefined) continue;
      const column = note.column - 1;
      const x = layout.playfield_left + layout.column_left[column]!;
      const width = layout.column_width[column]!;
      const head_y = Math.min(layout.receptor_y, layout.receptor_y - note.start_dt * speed);
      const tail_y = Math.min(layout.receptor_y, layout.receptor_y - note.end_dt * speed);
      const brightness = getLongNoteBrightness(note.state);
      this.addQuad(x + width * 0.14, tail_y, width * 0.72, Math.max(0, head_y - tail_y),
        [LONG_NOTE_COLOR[0] * brightness, LONG_NOTE_COLOR[1] * brightness, LONG_NOTE_COLOR[2] * brightness, LONG_NOTE_COLOR[3]]);
    }
    for (const note of notes) {
      const column = note.column - 1;
      const x = layout.playfield_left + layout.column_left[column]!;
      const width = layout.column_width[column]!;
      const y = layout.receptor_y - note.start_dt * speed;
      const brightness = note.end_dt === undefined ? 1 : getLongNoteBrightness(note.state);
      this.addQuad(x + 2, y, width - 4, Math.min(20, width * 0.4),
        [NOTE_COLOR[0] * brightness, NOTE_COLOR[1] * brightness, NOTE_COLOR[2] * brightness, NOTE_COLOR[3]]);
    }
  }

  private addFrame(x: number, y: number, width: number, height: number,
    color: readonly [number, number, number, number], thickness: number): void {
    this.addQuad(x, y, width, thickness, color);
    this.addQuad(x, y + height - thickness, width, thickness, color);
    this.addQuad(x, y + thickness, thickness, height - thickness * 2, color);
    this.addQuad(x + width - thickness, y + thickness, thickness, height - thickness * 2, color);
  }

  private addQuad(x: number, y: number, width: number, height: number,
    color: readonly [number, number, number, number], frame?: NoteSkinFrame): void {
    if (width <= 0 || height <= 0) return;
    const image = this.skin?.image;
    const u0 = frame && image ? frame.frame.x / image.width : 0;
    const v0 = frame && image ? frame.frame.y / image.height : 0;
    const u1 = frame && image ? (frame.frame.x + frame.frame.w) / image.width : 0;
    const v1 = frame && image ? (frame.frame.y + frame.frame.h) / image.height : 0;
    for (const [px, py, u, v] of [[x, y, u0, v0], [x + width, y, u1, v0], [x, y + height, u0, v1],
      [x, y + height, u0, v1], [x + width, y, u1, v0], [x + width, y + height, u1, v1]]) {
      this.vertices.push(px, py, u, v, ...color);
    }
  }

  private getLayout(column_count: number): Layout {
    const ratio = window.devicePixelRatio;
    const framebuffer_width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const framebuffer_height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== framebuffer_width || this.canvas.height !== framebuffer_height) {
      this.canvas.width = framebuffer_width;
      this.canvas.height = framebuffer_height;
    }
    const height = NOTE_SKIN_LOGICAL_HEIGHT;
    const width = height * framebuffer_width / framebuffer_height;
    const configured_widths = this.skin?.config.columnSize ?? Array.from({ length: column_count }, () => FALLBACK_COLUMN_WIDTH);
    const gap = this.skin ? 0 : FALLBACK_COLUMN_GAP;
    const natural_width = configured_widths.reduce((sum, value) => sum + value, 0) + gap * (column_count - 1);
    const scale = Math.min(1, width / natural_width);
    const column_width = configured_widths.map((value) => value * scale);
    const column_left: number[] = [];
    let offset = 0;
    for (const column_width_value of column_width) {
      column_left.push(offset);
      offset += column_width_value + gap * scale;
    }
    const playfield_width = offset - gap * scale;
    return {
      width, height, framebuffer_width, framebuffer_height, column_left, column_width,
      playfield_left: (width - playfield_width) * (this.skin?.config.align ?? 0.5),
      receptor_y: this.skin?.config.hitPosition ?? FALLBACK_HIT_POSITION,
    };
  }
}
