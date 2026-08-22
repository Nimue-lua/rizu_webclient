import type { LoadedGameplayAssets } from "../assets/GameplayAssetProvider";

const CIRCLE_SEGMENTS = 48;
const RECEPTOR_BOTTOM_MARGIN = 96;
const MAX_NOTE_RADIUS = 84;
const COLUMN_GAP = 3;
const EARLY_HIT_WINDOW_MS = 160;
const LATE_HIT_WINDOW_MS = 100;

const enum NoteState {
  Clear,
  Passed,
  Missed,
}

const vertex_shader_source = `#version 300 es
in vec2 position;
uniform vec2 center;
uniform vec2 viewport_size;
uniform float radius;

void main() {
  vec2 pixel_position = center + position * radius;
  vec2 clip_position = vec2(
    pixel_position.x / viewport_size.x * 2.0 - 1.0,
    1.0 - pixel_position.y / viewport_size.y * 2.0
  );
  gl_Position = vec4(clip_position, 0.0, 1.0);
}
`;

const fragment_shader_source = `#version 300 es
precision highp float;
uniform vec4 shape_color;
out vec4 color;

void main() {
  color = shape_color;
}
`;

interface Geometry {
  circle_count: number;
  ring_offset: number;
  ring_count: number;
  vertices: Float32Array;
}

function createGeometry(): Geometry {
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

  return {
    circle_count,
    ring_offset: circle_count,
    ring_count: (CIRCLE_SEGMENTS + 1) * 2,
    vertices: new Float32Array(vertices),
  };
}

function createShader(
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);

  if (!shader) {
    throw new Error("Failed to create WebGL shader");
  }

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

  if (!program) {
    gl.deleteShader(vertex_shader);
    gl.deleteShader(fragment_shader);
    throw new Error("Failed to create WebGL program");
  }

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

export class GameplayRuntime {
  private readonly canvas: HTMLCanvasElement;
  private readonly fps_element: HTMLElement;
  private readonly assets: LoadedGameplayAssets;
  private readonly master_volume: number;
  private readonly scroll_speed: number;
  private readonly finish: () => void;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vertex_array: WebGLVertexArrayObject;
  private readonly vertex_buffer: WebGLBuffer;
  private readonly center: WebGLUniformLocation;
  private readonly viewport_size: WebGLUniformLocation;
  private readonly radius: WebGLUniformLocation;
  private readonly shape_color: WebGLUniformLocation;
  private readonly geometry = createGeometry();
  private readonly note_states: Uint8Array;
  private readonly lane_notes: number[][];
  private readonly lane_cursors: Uint32Array;
  private readonly key_columns: ReadonlyMap<string, number>;
  private animation_frame: number | null = null;
  private audio_source: AudioBufferSourceNode | null = null;
  private audio_start_time = 0;
  private first_visible_note = 0;
  private fps_frame_count = 0;
  private fps_sample_start = 0;
  private miss_cursor = 0;

  constructor(
    canvas: HTMLCanvasElement,
    fps_element: HTMLElement,
    assets: LoadedGameplayAssets,
    master_volume: number,
    scroll_speed: number,
    input_bindings: readonly (string | null)[],
    finish: () => void,
  ) {
    const gl = canvas.getContext("webgl2");

    if (!gl) {
      throw new Error("WebGL 2 is required for gameplay");
    }

    const program = createProgram(gl);
    const vertex_array = gl.createVertexArray();
    const vertex_buffer = gl.createBuffer();
    const center = gl.getUniformLocation(program, "center");
    const viewport_size = gl.getUniformLocation(program, "viewport_size");
    const radius = gl.getUniformLocation(program, "radius");
    const shape_color = gl.getUniformLocation(program, "shape_color");

    if (!vertex_array || !vertex_buffer || !center || !viewport_size || !radius || !shape_color) {
      gl.deleteProgram(program);
      gl.deleteVertexArray(vertex_array);
      gl.deleteBuffer(vertex_buffer);
      throw new Error("Failed to create gameplay rendering resources");
    }

    this.canvas = canvas;
    this.fps_element = fps_element;
    this.assets = assets;
    this.master_volume = master_volume;
    this.scroll_speed = scroll_speed;
    this.finish = finish;
    this.gl = gl;
    this.program = program;
    this.vertex_array = vertex_array;
    this.vertex_buffer = vertex_buffer;
    this.center = center;
    this.viewport_size = viewport_size;
    this.radius = radius;
    this.shape_color = shape_color;

    this.note_states = new Uint8Array(assets.chart.notes.length);
    this.lane_notes = Array.from({ length: assets.chart.column_count }, () => []);
    this.lane_cursors = new Uint32Array(assets.chart.column_count);

    for (let index = 0; index < assets.chart.notes.length; index += 1) {
      const note = assets.chart.notes[index]!;
      this.lane_notes[note.column - 1]!.push(index);
    }

    this.key_columns = new Map(
      input_bindings.flatMap((code, column) => code === null ? [] : [[code, column] as const]),
    );

    gl.bindVertexArray(vertex_array);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.geometry.vertices, gl.STATIC_DRAW);

    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  }

  start() {
    window.addEventListener("keydown", this.handleKeyDown);

    const gain = this.assets.audio_context.createGain();
    const source = this.assets.audio_context.createBufferSource();
    gain.gain.value = this.master_volume;
    source.buffer = this.assets.audio_buffer;
    source.connect(gain).connect(this.assets.audio_context.destination);

    this.audio_start_time = this.assets.audio_context.currentTime + 0.1;
    this.fps_sample_start = performance.now();
    source.start(this.audio_start_time);
    this.audio_source = source;
    void this.assets.audio_context.resume();
    this.animation_frame = requestAnimationFrame(this.render);
  }

  destroy() {
    window.removeEventListener("keydown", this.handleKeyDown);

    if (this.animation_frame !== null) {
      cancelAnimationFrame(this.animation_frame);
    }

    if (this.audio_source) {
      this.audio_source.stop();
      this.audio_source.disconnect();
    }

    this.gl.deleteBuffer(this.vertex_buffer);
    this.gl.deleteVertexArray(this.vertex_array);
    this.gl.deleteProgram(this.program);
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) {
      return;
    }

    if (event.code === "Escape") {
      this.finish();
      return;
    }

    const column = this.key_columns.get(event.code);
    if (column === undefined) {
      return;
    }

    event.preventDefault();
    const song_time = this.getSongTime(event.timeStamp);
    this.updateMisses(song_time);

    const lane = this.lane_notes[column]!;
    let lane_cursor = this.lane_cursors[column]!;

    while (
      lane_cursor < lane.length &&
      this.note_states[lane[lane_cursor]!] !== NoteState.Clear
    ) {
      lane_cursor += 1;
    }

    this.lane_cursors[column] = lane_cursor;
    const note_index = lane[lane_cursor];
    if (note_index === undefined) {
      return;
    }

    const offset = song_time - this.assets.chart.notes[note_index]!.start_time;
    if (offset >= -EARLY_HIT_WINDOW_MS && offset <= LATE_HIT_WINDOW_MS) {
      this.note_states[note_index] = NoteState.Passed;
      this.lane_cursors[column] = lane_cursor + 1;
    }
  };

  private updateMisses(song_time: number) {
    const notes = this.assets.chart.notes;

    while (
      this.miss_cursor < notes.length &&
      notes[this.miss_cursor]!.start_time < song_time - LATE_HIT_WINDOW_MS
    ) {
      if (this.note_states[this.miss_cursor] === NoteState.Clear) {
        this.note_states[this.miss_cursor] = NoteState.Missed;
      }

      this.miss_cursor += 1;
    }
  }

  private getSongTime(performance_time: number) {
    const output_timestamp = this.assets.audio_context.getOutputTimestamp();
    const context_time = output_timestamp.contextTime;
    const output_performance_time = output_timestamp.performanceTime;
    const has_output_timestamp = context_time !== undefined &&
      output_performance_time !== undefined && output_performance_time > 0;
    const audio_time = has_output_timestamp
      ? context_time + (performance_time - output_performance_time) / 1000
      : this.assets.audio_context.currentTime +
        (performance_time - performance.now()) / 1000;

    return (audio_time - this.audio_start_time) * 1000;
  }

  private resize() {
    const pixel_ratio = window.devicePixelRatio;
    const width = Math.round(this.canvas.clientWidth * pixel_ratio);
    const height = Math.round(this.canvas.clientHeight * pixel_ratio);

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private drawCircle(x: number, y: number, radius: number) {
    this.gl.uniform2f(this.center, x, y);
    this.gl.uniform1f(this.radius, radius);
    this.gl.drawArrays(this.gl.TRIANGLE_FAN, 0, this.geometry.circle_count);
  }

  private drawRing(x: number, y: number, radius: number) {
    this.gl.uniform2f(this.center, x, y);
    this.gl.uniform1f(this.radius, radius);
    this.gl.drawArrays(
      this.gl.TRIANGLE_STRIP,
      this.geometry.ring_offset,
      this.geometry.ring_count,
    );
  }

  private draw(timestamp: number) {
    this.resize();

    const width = this.canvas.width;
    const height = this.canvas.height;
    const pixel_ratio = window.devicePixelRatio;
    const column_count = this.assets.chart.column_count;
    const gap = COLUMN_GAP * pixel_ratio;
    const note_radius = Math.min(
      MAX_NOTE_RADIUS * pixel_ratio,
      (width - gap * (column_count - 1)) / (column_count * 2),
    );
    const column_width = note_radius * 2 + gap;
    const playfield_width = note_radius * 2 * column_count + gap * (column_count - 1);
    const playfield_left = (width - playfield_width) / 2;
    const receptor_y = height - RECEPTOR_BOTTOM_MARGIN * pixel_ratio;
    const spawn_y = -note_radius;
    const song_time = this.getSongTime(timestamp);
    this.updateMisses(song_time);
    const pixels_per_ms = this.scroll_speed * pixel_ratio / 1000;
    const approach_time = (receptor_y - spawn_y) / pixels_per_ms;
    const despawn_time = (height + note_radius - receptor_y) / pixels_per_ms;
    const notes = this.assets.chart.notes;

    while (
      this.first_visible_note < notes.length &&
      notes[this.first_visible_note]!.start_time < song_time - despawn_time
    ) {
      this.first_visible_note += 1;
    }

    this.gl.viewport(0, 0, width, height);
    this.gl.clearColor(0.035, 0.035, 0.045, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.gl.useProgram(this.program);
    this.gl.bindVertexArray(this.vertex_array);
    this.gl.uniform2f(this.viewport_size, width, height);

    this.gl.uniform4f(this.shape_color, 0.3, 0.75, 1, 1);
    for (let column = 0; column < column_count; column += 1) {
      const x = playfield_left + note_radius + column_width * column;
      this.drawRing(x, receptor_y, note_radius);
    }

    this.gl.uniform4f(this.shape_color, 1, 1, 1, 1);
    for (let index = this.first_visible_note; index < notes.length; index += 1) {
      const note = notes[index]!;

      if (note.start_time > song_time + approach_time) {
        break;
      }

      if (this.note_states[index] !== NoteState.Clear) {
        continue;
      }

      const x = playfield_left + note_radius + column_width * (note.column - 1);
      const y = receptor_y - (note.start_time - song_time) * pixels_per_ms;
      this.drawCircle(x, y, note_radius);
    }
  }

  private readonly render = (timestamp: number) => {
    this.draw(timestamp);
    this.fps_frame_count += 1;

    const sample_duration = timestamp - this.fps_sample_start;
    if (sample_duration >= 500) {
      const fps = (this.fps_frame_count * 1000) / sample_duration;
      this.fps_element.textContent = `${Math.round(fps)} FPS`;
      this.fps_frame_count = 0;
      this.fps_sample_start = timestamp;
    }

    this.animation_frame = requestAnimationFrame(this.render);
  };
}
