import { useEffect, useRef } from "react";

const JUDGE_COLORS = [
  [0, 0.7, 1, 1],
  [1, 1, 0, 1],
  [0, 1, 0.5, 1],
  [0.3, 0.5, 1, 1],
  [1, 0, 1, 1],
  [1, 0, 0, 1],
] as const;
const MINIMUM_VISIBLE_SHARE = 0.01;
const GAP_WIDTH = 0.016;

const vertex_shader_source = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const fragment_shader_source = `#version 300 es
precision highp float;

uniform float u_thresholds[6];
uniform vec4 u_colors[6];
uniform vec3 u_panel_color;
in vec2 v_uv;
out vec4 out_color;

const float PI = 3.14159265359;
const float AA_STRENGTH = 0.75;
const float PADDING = 2.0;
const float INNER_RADIUS = 0.92;
const float OUTER_RADIUS = 1.0;
const float GAP_WIDTH = ${GAP_WIDTH};

void main() {
  vec2 padded_size = 1.0 - 2.0 * PADDING * fwidth(v_uv);
  vec2 uv = (vec2(v_uv.x, 1.0 - v_uv.y) * 2.0 - 1.0) / padded_size;
  float dist = length(uv);
  float edge_softness = fwidth(dist) * AA_STRENGTH;
  float inner_mask = smoothstep(INNER_RADIUS - edge_softness, INNER_RADIUS + edge_softness, dist);
  float outer_mask = 1.0 - smoothstep(OUTER_RADIUS - edge_softness, OUTER_RADIUS + edge_softness, dist);
  float ring_mask = inner_mask * outer_mask;

  float angle = atan(-uv.x, -uv.y);
  if (angle < 0.0) angle += 2.0 * PI;
  float t = angle / (2.0 * PI);
  vec4 segment_color = u_colors[0];

  for (int i = 0; i < 5; i++) {
    if (t > u_thresholds[i]) segment_color = u_colors[i + 1];
  }

  float gap_mask = 1.0;
  float t_gap = GAP_WIDTH / (2.0 * PI);
  for (int i = 0; i < 6; i++) {
    float difference = abs(t - u_thresholds[i]);
    if (difference > 0.5) difference = 1.0 - difference;
    float gap_softness = fwidth(t) * AA_STRENGTH;
    gap_mask *= smoothstep(t_gap - gap_softness, t_gap + gap_softness, difference);
  }

  float coverage = ring_mask * gap_mask * segment_color.a;
  vec3 color = mix(u_panel_color, segment_color.rgb, coverage);
  out_color = vec4(color * outer_mask, outer_mask);
}`;

function calculateThresholds(judges: readonly number[]): Float32Array | null {
  const normalized_judges = Array.from({ length: 6 }, (_, index) => judges[index] ?? 0);
  const total = normalized_judges.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;

  const shares = normalized_judges.map(() => 0);
  const remaining_indices = normalized_judges.flatMap((count, index) => count > 0 ? [index] : []);
  let remaining_total = total;
  let remaining_share = 1;

  while (remaining_indices.length > 0) {
    // Reserve enough threshold space for the gaps so the colored arc itself
    // retains the same 1% minimum used by the native result renderer.
    const minimum_allocated_share = MINIMUM_VISIBLE_SHARE + GAP_WIDTH / Math.PI;
    const constrained_position = remaining_indices.findIndex((index) =>
      normalized_judges[index]! / remaining_total * remaining_share < minimum_allocated_share);
    if (constrained_position === -1) {
      for (const index of remaining_indices) shares[index] = normalized_judges[index]! / remaining_total * remaining_share;
      break;
    }

    const [index] = remaining_indices.splice(constrained_position, 1);
    shares[index!] = minimum_allocated_share;
    remaining_total -= normalized_judges[index!]!;
    remaining_share -= minimum_allocated_share;
  }

  const thresholds = new Float32Array(6);
  let current = 0;
  for (let index = 0; index < 5; index += 1) {
    current += shares[index]!;
    thresholds[index] = current;
  }
  thresholds[5] = 1;
  return thresholds;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

export function JudgeSegmentsCanvas({ judges, judge_names }: {
  judges: readonly number[];
  judge_names: readonly string[];
}) {
  const canvas_ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvas_ref.current;
    const thresholds = calculateThresholds(judges);
    if (!canvas || !thresholds) return;

    const pixel_ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * pixel_ratio);
    canvas.height = Math.round(canvas.clientHeight * pixel_ratio);
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!gl) return;

    const vertex_shader = compileShader(gl, gl.VERTEX_SHADER, vertex_shader_source);
    const fragment_shader = compileShader(gl, gl.FRAGMENT_SHADER, fragment_shader_source);
    if (!vertex_shader || !fragment_shader) return;

    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    if (!program || !buffer) return;
    gl.attachShader(program, vertex_shader);
    gl.attachShader(program, fragment_shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1fv(gl.getUniformLocation(program, "u_thresholds"), thresholds);
    const colors = JUDGE_COLORS.map((color, index) => judge_names[index] === "miss" ? JUDGE_COLORS[5] : color);
    gl.uniform4fv(gl.getUniformLocation(program, "u_colors"), new Float32Array(colors.flat()));
    gl.uniform3f(gl.getUniformLocation(program, "u_panel_color"), 33 / 255, 28 / 255, 43 / 255);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return () => {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex_shader);
      gl.deleteShader(fragment_shader);
    };
  }, [judges, judge_names]);

  return <canvas ref={canvas_ref} className="judge-segments-canvas" />;
}
