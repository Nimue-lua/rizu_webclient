import type { OsuSlider } from "../../chart/Chart";
import type { OsuSliderPath } from "../OsuSliderPath";
import type { OsuViewport } from "../OsuViewport";
import type { GameplayFrame } from "./GameplayFrame";
import { createOsuSliderMesh } from "./OsuSliderMesh";

const VERTEX_FLOATS = 3;
const MAX_SLIDER_BUFFER_BYTES = 64 * 1024 * 1024;

const vertex_source = `#version 300 es
in vec2 position;
in float edge_distance;
uniform vec2 viewport_size;
uniform vec2 playfield_scale;
uniform vec2 playfield_offset;
uniform float depth_bias;
out float radial;
void main() {
  vec2 screen = playfield_offset + position * playfield_scale;
  gl_Position = vec4(screen.x / viewport_size.x * 2.0 - 1.0, 1.0 - screen.y / viewport_size.y * 2.0,
    edge_distance * 1.8 - 0.8 - depth_bias, 1.0);
  radial = edge_distance;
}`;

const fragment_source = `#version 300 es
precision highp float;
in float radial;
uniform vec4 body_color;
uniform vec4 border_color;
uniform float opacity;
out vec4 color;
void main() {
  float track_position = 1.0 - radial;
  float aa = max(fwidth(track_position), 3.0 / 256.0);
  vec4 shadow = vec4(0.0, 0.0, 0.0, 64.0 / 255.0);
  vec3 outer_rgb = body_color.rgb / 1.1;
  vec3 inner_rgb = min(vec3(1.0), body_color.rgb * 1.125 + vec3(0.25));
  vec4 outer = vec4(outer_rgb, (180.0 / 255.0) * body_color.a);
  vec4 inner = vec4(inner_rgb, (180.0 / 255.0) * body_color.a);

  vec4 tint;
  if (track_position < 0.078125 - aa) {
    tint = shadow * smoothstep(0.0, 0.078125 - aa, track_position);
  } else if (track_position < 0.078125 + aa) {
    tint = mix(shadow, border_color,
      smoothstep(0.078125 - aa, 0.078125 + aa, track_position));
  } else if (track_position < 0.1875 - aa) {
    tint = border_color;
  } else if (track_position < 0.1875 + aa) {
    tint = mix(border_color, outer,
      smoothstep(0.1875 - aa, 0.1875 + aa, track_position));
  } else {
    tint = mix(outer, inner, (track_position - 0.1875) / 0.8125);
  }
  float alpha = tint.a * opacity;
  color = vec4(tint.rgb * alpha, alpha);
}`;

interface UploadedMesh {
  readonly vertex_array: WebGLVertexArrayObject;
  readonly vertex_buffer: WebGLBuffer;
  readonly index_buffer: WebGLBuffer;
  readonly index_count: number;
}

export class WebGlSliderGraphics {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Readonly<Record<"viewport" | "scale" | "offset" | "depth_bias" | "body" | "border" | "opacity", WebGLUniformLocation>>;
  private readonly meshes = new Map<OsuSlider, UploadedMesh>();
  private uploaded_bytes = 0;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL 2 is required for slider rendering");
    const program = createProgram(gl);
    const uniforms = {
      viewport: gl.getUniformLocation(program, "viewport_size"), scale: gl.getUniformLocation(program, "playfield_scale"),
      offset: gl.getUniformLocation(program, "playfield_offset"), depth_bias: gl.getUniformLocation(program, "depth_bias"),
      body: gl.getUniformLocation(program, "body_color"), border: gl.getUniformLocation(program, "border_color"),
      opacity: gl.getUniformLocation(program, "opacity"),
    };
    if (Object.values(uniforms).some((uniform) => !uniform)) {
      gl.deleteProgram(program);
      throw new Error("Failed to create slider rendering resources");
    }
    this.gl = gl;
    this.program = program;
    this.uniforms = uniforms as typeof this.uniforms;
  }

  has(slider: OsuSlider): boolean { return this.meshes.has(slider); }

  upload(slider: OsuSlider, path: OsuSliderPath, radius: number): boolean {
    if (this.meshes.has(slider)) return true;
    const mesh = createOsuSliderMesh(path, radius);
    const bytes = mesh.vertices.byteLength + mesh.indices.byteLength;
    if (bytes > MAX_SLIDER_BUFFER_BYTES - this.uploaded_bytes) return false;
    const vertex_array = this.gl.createVertexArray();
    const vertex_buffer = this.gl.createBuffer();
    const index_buffer = this.gl.createBuffer();
    if (!vertex_array || !vertex_buffer || !index_buffer) {
      this.gl.deleteVertexArray(vertex_array);
      this.gl.deleteBuffer(vertex_buffer);
      this.gl.deleteBuffer(index_buffer);
      throw new Error("Failed to create slider mesh buffers");
    }
    this.gl.bindVertexArray(vertex_array);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vertex_buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, mesh.vertices, this.gl.STATIC_DRAW);
    const stride = VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
    for (const [name, size, offset] of [["position", 2, 0], ["edge_distance", 1, 2]] as const) {
      const location = this.gl.getAttribLocation(this.program, name);
      if (location < 0) throw new Error(`Slider shader is missing ${name}`);
      this.gl.enableVertexAttribArray(location);
      this.gl.vertexAttribPointer(location, size, this.gl.FLOAT, false, stride, offset * Float32Array.BYTES_PER_ELEMENT);
    }
    this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, index_buffer);
    this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, mesh.indices, this.gl.STATIC_DRAW);
    this.meshes.set(slider, { vertex_array, vertex_buffer, index_buffer, index_count: mesh.indices.length });
    this.uploaded_bytes += bytes;
    return true;
  }

  draw(slider: OsuSlider, viewport: OsuViewport, frame: GameplayFrame,
    body: readonly [number, number, number, number], border: readonly [number, number, number, number], opacity: number): void {
    const mesh = this.meshes.get(slider);
    if (!mesh || mesh.index_count === 0) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(mesh.vertex_array);
    gl.uniform2f(this.uniforms.viewport, frame.logical_width, frame.logical_height);
    const scale_x = viewport.x_flip ? -viewport.scale : viewport.scale;
    const scale_y = viewport.y_flip ? -viewport.scale : viewport.scale;
    const origin = viewport.playfieldToScreen({ x: 0, y: 0 });
    gl.uniform2f(this.uniforms.scale, scale_x, scale_y);
    gl.uniform2f(this.uniforms.offset, origin.x, origin.y);
    gl.uniform4f(this.uniforms.body, ...body);
    gl.uniform4f(this.uniforms.border, ...border);
    gl.uniform1f(this.uniforms.opacity, Math.min(Math.max(opacity, 0), 1));

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.colorMask(false, false, false, false);
    gl.depthFunc(gl.LEQUAL);
    gl.uniform1f(this.uniforms.depth_bias, 0);
    gl.drawElements(gl.TRIANGLES, mesh.index_count, gl.UNSIGNED_INT, 0);

    gl.colorMask(true, true, true, true);
    gl.depthFunc(gl.LESS);
    gl.uniform1f(this.uniforms.depth_bias, 1 / 65_536);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawElements(gl.TRIANGLES, mesh.index_count, gl.UNSIGNED_INT, 0);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const mesh of this.meshes.values()) {
      this.gl.deleteVertexArray(mesh.vertex_array);
      this.gl.deleteBuffer(mesh.vertex_buffer);
      this.gl.deleteBuffer(mesh.index_buffer);
    }
    this.meshes.clear();
    this.uploaded_bytes = 0;
    this.gl.deleteProgram(this.program);
  }
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const shaders = [[gl.VERTEX_SHADER, vertex_source], [gl.FRAGMENT_SHADER, fragment_source]] as const;
  const compiled = shaders.map(([type, source]) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Failed to create slider shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) ?? "Unknown slider shader error";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  });
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create slider program");
  for (const shader of compiled) gl.attachShader(program, shader);
  gl.linkProgram(program);
  for (const shader of compiled) gl.deleteShader(shader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Unknown slider program error";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}
