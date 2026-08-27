import type { OsuSlider } from "../../chart/Chart";
import type { OsuSliderPath } from "../OsuSliderPath";
import type { OsuViewport } from "../OsuViewport";
import type { GameplayFrame } from "./GameplayFrame";
import { createOsuSliderMesh, createOsuStableLinearMesh } from "./OsuSliderMesh";

const VERTEX_FLOATS = 3;
const MAX_SLIDER_BUFFER_BYTES = 64 * 1024 * 1024;
const STABLE_MAX_VIEWPORT_DIMENSION = 16_384;

export type OsuSliderRendererMode = "direct" | "stable";

export function osuSliderRendererMode(value: string | null): OsuSliderRendererMode {
  return value === "stable" ? "stable" : "direct";
}

const vertex_source = `#version 300 es
in vec2 position;
in float edge_distance;
uniform vec2 viewport_size;
uniform vec2 playfield_scale;
uniform vec2 playfield_offset;
uniform vec2 stable_body_origin;
uniform vec2 stable_viewport_scale;
uniform float projection_y_direction;
uniform float depth_bias;
out float radial;
void main() {
  vec2 screen = playfield_offset + position * playfield_scale;
  screen = stable_body_origin + (screen - stable_body_origin) * stable_viewport_scale;
  gl_Position = vec4(screen.x / viewport_size.x * 2.0 - 1.0,
    projection_y_direction * (1.0 - screen.y / viewport_size.y * 2.0),
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

const composite_vertex_source = `#version 300 es
uniform vec2 viewport_size;
uniform vec2 body_origin;
out vec2 texture_position;
void main() {
  vec2 corner = vec2(float((gl_VertexID == 1 || gl_VertexID == 2 || gl_VertexID == 4) ? 1 : 0),
    float((gl_VertexID == 2 || gl_VertexID == 4 || gl_VertexID == 5) ? 1 : 0));
  vec2 screen = body_origin + corner * viewport_size;
  gl_Position = vec4(screen.x / viewport_size.x * 2.0 - 1.0,
    1.0 - screen.y / viewport_size.y * 2.0, 0.0, 1.0);
  texture_position = corner;
}`;

const composite_fragment_source = `#version 300 es
precision highp float;
in vec2 texture_position;
uniform sampler2D slider_texture;
uniform float opacity;
out vec4 color;
void main() {
  color = texture(slider_texture, texture_position) * opacity;
}`;

interface UploadedMesh {
  readonly vertex_array: WebGLVertexArrayObject;
  readonly vertex_buffer: WebGLBuffer;
  readonly index_buffer: WebGLBuffer;
  readonly index_count: number;
  readonly bounds: Readonly<{ left: number; top: number; right: number; bottom: number }>;
  readonly radius: number;
}

export class WebGlSliderGraphics {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Readonly<Record<"viewport" | "scale" | "offset" | "stable_origin" | "stable_scale" |
    "projection_y" | "depth_bias" | "body" | "border" | "opacity", WebGLUniformLocation>>;
  private readonly max_viewport: readonly [number, number];
  private readonly composite_program: WebGLProgram | null;
  private readonly composite_vertex_array: WebGLVertexArrayObject | null;
  private stable_target: { framebuffer: WebGLFramebuffer; texture: WebGLTexture; depth: WebGLRenderbuffer;
    width: number; height: number } | null = null;
  private readonly meshes = new Map<OsuSlider, UploadedMesh>();
  private uploaded_bytes = 0;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, private readonly mode: OsuSliderRendererMode = "direct") {
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL 2 is required for slider rendering");
    const program = createProgram(gl, vertex_source, fragment_source);
    const uniforms = {
      viewport: gl.getUniformLocation(program, "viewport_size"), scale: gl.getUniformLocation(program, "playfield_scale"),
      offset: gl.getUniformLocation(program, "playfield_offset"), depth_bias: gl.getUniformLocation(program, "depth_bias"),
      stable_origin: gl.getUniformLocation(program, "stable_body_origin"),
      stable_scale: gl.getUniformLocation(program, "stable_viewport_scale"),
      projection_y: gl.getUniformLocation(program, "projection_y_direction"),
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
    const max_viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | number[];
    this.max_viewport = [Math.min(max_viewport[0]!, STABLE_MAX_VIEWPORT_DIMENSION),
      Math.min(max_viewport[1]!, STABLE_MAX_VIEWPORT_DIMENSION)];
    this.composite_program = mode === "stable" ? createProgram(gl, composite_vertex_source, composite_fragment_source) : null;
    this.composite_vertex_array = mode === "stable" ? gl.createVertexArray() : null;
    if (mode === "stable" && !this.composite_vertex_array) throw new Error("Failed to create stable slider composite resources");
  }

  has(slider: OsuSlider): boolean { return this.meshes.has(slider); }

  upload(slider: OsuSlider, path: OsuSliderPath, radius: number): boolean {
    if (this.meshes.has(slider)) return true;
    const mesh = this.mode === "stable" && slider.curve_type === "linear" && slider.control_points.length > 2_048
      ? createOsuStableLinearMesh(slider, radius)
      : createOsuSliderMesh(path, radius);
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
    this.meshes.set(slider, {
      vertex_array, vertex_buffer, index_buffer, index_count: mesh.indices.length, bounds: mesh.bounds, radius,
    });
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
    if (this.mode === "stable") {
      this.drawStable(mesh, viewport, frame, body, border, opacity);
      return;
    }
    const stable = directBodyTransform(frame);
    gl.uniform2f(this.uniforms.stable_origin, stable.origin_x, stable.origin_y);
    gl.uniform2f(this.uniforms.stable_scale, stable.scale_x, stable.scale_y);
    gl.uniform1f(this.uniforms.projection_y, 1);
    gl.uniform4f(this.uniforms.body, ...body);
    gl.uniform4f(this.uniforms.border, ...border);
    gl.uniform1f(this.uniforms.opacity, Math.min(Math.max(opacity, 0), 1));

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(stable.clip_x, stable.clip_y, stable.clip_width, stable.clip_height);
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
    gl.disable(gl.SCISSOR_TEST);
  }

  private drawStable(mesh: UploadedMesh, viewport: OsuViewport, frame: GameplayFrame,
    body: readonly [number, number, number, number], border: readonly [number, number, number, number], opacity: number): void {
    const gl = this.gl;
    const target = this.ensureStableTarget(frame);
    const layout = stableBodyLayout(mesh.bounds, mesh.radius, viewport, frame, this.max_viewport);
    const pixel_x = frame.framebuffer_width / frame.logical_width;
    const pixel_y = frame.framebuffer_height / frame.logical_height;
    const origin = viewport.playfieldToScreen({ x: 0, y: 0 });
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, layout.viewport_width, layout.viewport_height);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(mesh.vertex_array);
    gl.uniform2f(this.uniforms.viewport, layout.requested_width, layout.requested_height);
    gl.uniform2f(this.uniforms.scale, (viewport.x_flip ? -viewport.scale : viewport.scale) * pixel_x,
      (viewport.y_flip ? -viewport.scale : viewport.scale) * pixel_y);
    gl.uniform2f(this.uniforms.offset, origin.x * pixel_x - layout.body_x, origin.y * pixel_y - layout.body_y);
    gl.uniform2f(this.uniforms.stable_origin, 0, 0);
    gl.uniform2f(this.uniforms.stable_scale, 1, 1);
    gl.uniform1f(this.uniforms.projection_y, -1);
    gl.uniform4f(this.uniforms.body, ...body);
    gl.uniform4f(this.uniforms.border, ...border);
    gl.uniform1f(this.uniforms.opacity, 1);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.uniform1f(this.uniforms.depth_bias, 0);
    gl.drawElements(gl.TRIANGLES, mesh.index_count, gl.UNSIGNED_INT, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, frame.framebuffer_width, frame.framebuffer_height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.depthMask(false);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.composite_program);
    gl.bindVertexArray(this.composite_vertex_array);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.uniform1i(gl.getUniformLocation(this.composite_program!, "slider_texture"), 0);
    gl.uniform2f(gl.getUniformLocation(this.composite_program!, "viewport_size"), frame.logical_width, frame.logical_height);
    gl.uniform2f(gl.getUniformLocation(this.composite_program!, "body_origin"), layout.body_x / pixel_x, layout.body_y / pixel_y);
    gl.uniform1f(gl.getUniformLocation(this.composite_program!, "opacity"), Math.min(Math.max(opacity, 0), 1));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private ensureStableTarget(frame: GameplayFrame) {
    const width = frame.framebuffer_width;
    const height = frame.framebuffer_height;
    if (this.stable_target?.width === width && this.stable_target.height === height) {
      return this.stable_target;
    }
    this.destroyStableTarget();
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    const texture = gl.createTexture();
    const depth = gl.createRenderbuffer();
    if (!framebuffer || !texture || !depth) throw new Error("Failed to create stable slider framebuffer");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      gl.deleteRenderbuffer(depth);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      throw new Error("Stable slider framebuffer is incomplete");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.stable_target = { framebuffer, texture, depth, width, height };
    return this.stable_target;
  }

  private destroyStableTarget(): void {
    if (!this.stable_target) return;
    this.gl.deleteFramebuffer(this.stable_target.framebuffer);
    this.gl.deleteTexture(this.stable_target.texture);
    this.gl.deleteRenderbuffer(this.stable_target.depth);
    this.stable_target = null;
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
    this.destroyStableTarget();
    if (this.composite_vertex_array) this.gl.deleteVertexArray(this.composite_vertex_array);
    if (this.composite_program) this.gl.deleteProgram(this.composite_program);
    this.gl.deleteProgram(this.program);
  }
}

function directBodyTransform(frame: GameplayFrame): StableBodyTransform {
  return {
    origin_x: 0,
    origin_y: 0,
    scale_x: 1,
    scale_y: 1,
    clip_x: 0,
    clip_y: 0,
    clip_width: frame.framebuffer_width,
    clip_height: frame.framebuffer_height,
  };
}

interface StableBodyTransform {
  readonly origin_x: number;
  readonly origin_y: number;
  readonly scale_x: number;
  readonly scale_y: number;
  readonly clip_x: number;
  readonly clip_y: number;
  readonly clip_width: number;
  readonly clip_height: number;
}

export function stableBodyTransform(bounds: Readonly<{ left: number; top: number; right: number; bottom: number }>,
  radius: number, viewport: OsuViewport, frame: GameplayFrame,
  max_viewport: readonly [number, number]): StableBodyTransform {
  const first = viewport.playfieldToScreen({ x: bounds.left, y: bounds.top });
  const second = viewport.playfieldToScreen({ x: bounds.right, y: bounds.bottom });
  const pixel_x = frame.framebuffer_width / frame.logical_width;
  const pixel_y = frame.framebuffer_height / frame.logical_height;
  const left = Math.min(first.x, second.x) * pixel_x;
  const top = Math.min(first.y, second.y) * pixel_y;
  const width = Math.abs(second.x - first.x) * pixel_x;
  const height = Math.abs(second.y - first.y) * pixel_y;
  const radius_x = radius * viewport.scale * pixel_x;
  const radius_y = radius * viewport.scale * pixel_y;

  // The mesh bounds include one radius; stable pads by 1.15 radii and truncates to integer display pixels.
  const draw_left = Math.trunc(left - radius_x * 0.15);
  const draw_top = Math.trunc(top - radius_y * 0.15);
  const draw_width = Math.max(1, Math.trunc(width + radius_x * 0.3));
  const draw_height = Math.max(1, Math.trunc(height + radius_y * 0.3));
  const excess_left = Math.max(-draw_left, 0);
  const excess_top = Math.max(-draw_top, 0);
  const body_x = draw_left + excess_left;
  const body_y = draw_top + excess_top;
  const requested_height = Math.max(1, draw_height - excess_top);
  const scale_x = Math.min(draw_width, max_viewport[0]) / draw_width;
  const scale_y = Math.min(requested_height, max_viewport[1]) / requested_height;

  const clip_left = Math.max(0, body_x);
  const clip_top = Math.max(0, body_y);
  const clip_right = Math.min(frame.framebuffer_width, body_x + frame.framebuffer_width);
  const clip_bottom = Math.min(frame.framebuffer_height, body_y + frame.framebuffer_height);
  return {
    origin_x: body_x / pixel_x,
    origin_y: body_y / pixel_y,
    scale_x,
    scale_y,
    clip_x: Math.round(clip_left),
    clip_y: Math.round(frame.framebuffer_height - clip_bottom),
    clip_width: Math.max(0, Math.round(clip_right - clip_left)),
    clip_height: Math.max(0, Math.round(clip_bottom - clip_top)),
  };
}

function stableBodyLayout(bounds: Readonly<{ left: number; top: number; right: number; bottom: number }>,
  radius: number, viewport: OsuViewport, frame: GameplayFrame, max_viewport: readonly [number, number]) {
  const first = viewport.playfieldToScreen({ x: bounds.left, y: bounds.top });
  const second = viewport.playfieldToScreen({ x: bounds.right, y: bounds.bottom });
  const pixel_x = frame.framebuffer_width / frame.logical_width;
  const pixel_y = frame.framebuffer_height / frame.logical_height;
  const left = Math.min(first.x, second.x) * pixel_x;
  const top = Math.min(first.y, second.y) * pixel_y;
  const width = Math.abs(second.x - first.x) * pixel_x;
  const height = Math.abs(second.y - first.y) * pixel_y;
  const draw_left = Math.trunc(left - radius * viewport.scale * pixel_x * 0.15);
  const draw_top = Math.trunc(top - radius * viewport.scale * pixel_y * 0.15);
  const draw_width = Math.max(1, Math.trunc(width + radius * viewport.scale * pixel_x * 0.3));
  const draw_height = Math.max(1, Math.trunc(height + radius * viewport.scale * pixel_y * 0.3));
  const body_x = draw_left + Math.max(-draw_left, 0);
  const body_y = draw_top + Math.max(-draw_top, 0);
  const requested_height = Math.max(1, draw_height - Math.max(-draw_top, 0));
  return { body_x, body_y, requested_width: draw_width, requested_height,
    viewport_width: Math.min(draw_width, max_viewport[0]), viewport_height: Math.min(requested_height, max_viewport[1]) };
}

function createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const shaders = [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const;
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
