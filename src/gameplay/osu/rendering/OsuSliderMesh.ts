import type { Point } from "../OsuViewport";
import type { OsuSliderPath } from "../OsuSliderPath";
import type { OsuSlider } from "../../../chart/Chart";

const CIRCLE_SEGMENTS = 24;
const MAX_RENDER_POINTS = 2_048;
const RENDER_POINT_DISTANCE = 6;
const VERTEX_FLOATS = 3;

export interface OsuSliderMeshData {
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly wireframe_indices: Uint32Array;
  readonly bounds: Readonly<{ left: number; top: number; right: number; bottom: number }>;
}

export interface OsuStableLinearMeshData {
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly bounds: Readonly<{ left: number; top: number; right: number; bottom: number }>;
}

export function createOsuStableLinearMesh(slider: OsuSlider, radius: number): OsuStableLinearMeshData {
  const points = [{ x: slider.x, y: slider.y }, ...slider.control_points];
  let generated_length = 0;
  let last_nonzero = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
    generated_length += length;
    if (length > 0) last_nonzero = index;
  }
  const target_length = Math.max(0, slider.pixel_length);
  let remaining = target_length;
  let segment_count = 0;
  for (let index = 1; index < points.length && remaining > 0; index += 1) {
    const length = Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
    if (length === 0) continue;
    segment_count += 1;
    remaining -= Math.min(length, remaining);
  }
  if (target_length > generated_length && last_nonzero > 0) segment_count += 1;

  const vertices = new Float32Array(segment_count * 6 * VERTEX_FLOATS);
  const indices = new Uint32Array(segment_count * 12);
  let vertex_offset = 0;
  let index_offset = 0;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const writeSegment = (start: Point, end: Point) => {
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length === 0) return;
    const normal_x = -(end.y - start.y) / length * radius;
    const normal_y = (end.x - start.x) / length * radius;
    const values = [start.x + normal_x, start.y + normal_y, 1, start.x, start.y, 0,
      start.x - normal_x, start.y - normal_y, 1,
      end.x + normal_x, end.y + normal_y, 1,
      end.x, end.y, 0, end.x - normal_x, end.y - normal_y, 1];
    const base = vertex_offset / VERTEX_FLOATS;
    vertices.set(values, vertex_offset);
    vertex_offset += values.length;
    indices.set([base, base + 1, base + 3, base + 3, base + 1, base + 4,
      base + 1, base + 2, base + 4, base + 4, base + 2, base + 5], index_offset);
    index_offset += 12;
    left = Math.min(left, start.x - radius, end.x - radius);
    top = Math.min(top, start.y - radius, end.y - radius);
    right = Math.max(right, start.x + radius, end.x + radius);
    bottom = Math.max(bottom, start.y + radius, end.y + radius);
  };

  remaining = target_length;
  let final_start: Point | null = null;
  let final_end: Point | null = null;
  for (let index = 1; index < points.length && remaining > 0; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length === 0) continue;
    const used = Math.min(length, remaining);
    const adjusted_end = used === length ? end : {
      x: start.x + (end.x - start.x) * used / length,
      y: start.y + (end.y - start.y) * used / length,
    };
    writeSegment(start, adjusted_end);
    final_start = start;
    final_end = adjusted_end;
    remaining -= used;
  }
  if (remaining > 0 && final_start && final_end) {
    const length = Math.hypot(final_end.x - final_start.x, final_end.y - final_start.y);
    writeSegment(final_end, {
      x: final_end.x + (final_end.x - final_start.x) * remaining / length,
      y: final_end.y + (final_end.y - final_start.y) * remaining / length,
    });
  }
  if (!Number.isFinite(left)) {
    left = slider.x - radius;
    top = slider.y - radius;
    right = slider.x + radius;
    bottom = slider.y + radius;
  }
  return { vertices, indices, bounds: { left, top, right, bottom } };
}

export function createOsuSliderMesh(path: OsuSliderPath, radius: number): OsuSliderMeshData {
  const points = simplify(path.points);
  const vertices: number[] = [];
  const indices: number[] = [];
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const vertex = (x: number, y: number, edge_distance: number) => {
    const index = vertices.length / VERTEX_FLOATS;
    vertices.push(x, y, edge_distance);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
    return index;
  };

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length === 0) continue;
    const normal_x = -(end.y - start.y) / length * radius;
    const normal_y = (end.x - start.x) / length * radius;
    const base = vertices.length / VERTEX_FLOATS;
    vertex(start.x + normal_x, start.y + normal_y, 1);
    vertex(start.x, start.y, 0);
    vertex(start.x - normal_x, start.y - normal_y, 1);
    vertex(end.x + normal_x, end.y + normal_y, 1);
    vertex(end.x, end.y, 0);
    vertex(end.x - normal_x, end.y - normal_y, 1);
    indices.push(base, base + 1, base + 3, base + 3, base + 1, base + 4,
      base + 1, base + 2, base + 4, base + 4, base + 2, base + 5);
  }
  for (let index = 1; index < points.length - 1; index += 1) {
    addRoundJoin(points[index - 1]!, points[index]!, points[index + 1]!, radius, vertex, indices);
  }
  for (const point of points.length > 1 ? [points[0]!, points.at(-1)!] : points) {
    const base = vertices.length / VERTEX_FLOATS;
    vertex(point.x, point.y, 0);
    for (let segment = 0; segment < CIRCLE_SEGMENTS; segment += 1) {
      const angle = segment / CIRCLE_SEGMENTS * Math.PI * 2;
      vertex(point.x + Math.cos(angle) * radius, point.y + Math.sin(angle) * radius, 1);
    }
    for (let segment = 0; segment < CIRCLE_SEGMENTS; segment += 1) {
      indices.push(base, base + 1 + segment, base + 1 + (segment + 1) % CIRCLE_SEGMENTS);
    }
  }
  if (vertices.length === 0) {
    vertex(path.points[0]!.x, path.points[0]!.y, 0);
    left -= radius;
    top -= radius;
    right += radius;
    bottom += radius;
  }
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    wireframe_indices: createWireframeIndices(indices),
    bounds: { left, top, right, bottom },
  };
}

function addRoundJoin(previous: Point, point: Point, next: Point, radius: number,
  vertex: (x: number, y: number, edge_distance: number) => number, indices: number[]): void {
  const before_length = Math.hypot(point.x - previous.x, point.y - previous.y);
  const after_length = Math.hypot(next.x - point.x, next.y - point.y);
  if (before_length === 0 || after_length === 0) return;
  const before_x = (point.x - previous.x) / before_length;
  const before_y = (point.y - previous.y) / before_length;
  const after_x = (next.x - point.x) / after_length;
  const after_y = (next.y - point.y) / after_length;
  const cross = before_x * after_y - before_y * after_x;
  if (Math.abs(cross) < 1e-6) {
    if (before_x * after_x + before_y * after_y < 0) {
      addTurnaroundCap(point, before_x, before_y, radius, vertex, indices);
    }
    return;
  }

  const side = cross > 0 ? -1 : 1;
  let start_angle = Math.atan2(before_x * side, -before_y * side);
  let end_angle = Math.atan2(after_x * side, -after_y * side);
  if (cross > 0) {
    while (end_angle < start_angle) end_angle += Math.PI * 2;
  } else {
    while (end_angle > start_angle) end_angle -= Math.PI * 2;
  }
  const sweep = end_angle - start_angle;
  const segments = Math.max(1, Math.ceil(Math.abs(sweep) * CIRCLE_SEGMENTS / (Math.PI * 2)));
  const center = vertex(point.x, point.y, 0);
  let previous_edge = vertex(point.x + Math.cos(start_angle) * radius,
    point.y + Math.sin(start_angle) * radius, 1);
  for (let segment = 1; segment <= segments; segment += 1) {
    const angle = start_angle + sweep * segment / segments;
    const edge = vertex(point.x + Math.cos(angle) * radius, point.y + Math.sin(angle) * radius, 1);
    if (cross > 0) indices.push(center, previous_edge, edge);
    else indices.push(center, edge, previous_edge);
    previous_edge = edge;
  }
}

function addTurnaroundCap(point: Point, direction_x: number, direction_y: number, radius: number,
  vertex: (x: number, y: number, edge_distance: number) => number, indices: number[]): void {
  const center = vertex(point.x, point.y, 0);
  const direction_angle = Math.atan2(direction_y, direction_x);
  let previous_edge = vertex(point.x + Math.cos(direction_angle - Math.PI / 2) * radius,
    point.y + Math.sin(direction_angle - Math.PI / 2) * radius, 1);
  for (let segment = 1; segment <= CIRCLE_SEGMENTS / 2; segment += 1) {
    const angle = direction_angle - Math.PI / 2 + Math.PI * segment / (CIRCLE_SEGMENTS / 2);
    const edge = vertex(point.x + Math.cos(angle) * radius, point.y + Math.sin(angle) * radius, 1);
    indices.push(center, previous_edge, edge);
    previous_edge = edge;
  }
}

function createWireframeIndices(indices: readonly number[]): Uint32Array {
  const edges = new Map<string, readonly [number, number]>();
  for (let index = 0; index < indices.length; index += 3) {
    const triangle = [indices[index]!, indices[index + 1]!, indices[index + 2]!] as const;
    for (const [first, second] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]],
      [triangle[2], triangle[0]]] as const) {
      const edge = first < second ? [first, second] as const : [second, first] as const;
      edges.set(`${edge[0]}:${edge[1]}`, edge);
    }
  }
  return new Uint32Array([...edges.values()].flatMap((edge) => edge));
}

function simplify(points: readonly Point[]): Point[] {
  if (points.length <= 2) return [...points];
  const simplified = [points[0]!];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified.at(-1)!;
    const point = points[index]!;
    const next = points[index + 1]!;
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= RENDER_POINT_DISTANCE ||
      isSharpTurn(points[index - 1]!, point, next)) simplified.push(point);
  }
  simplified.push(points.at(-1)!);
  if (simplified.length <= MAX_RENDER_POINTS) return simplified;
  return Array.from({ length: MAX_RENDER_POINTS }, (_, index) =>
    simplified[Math.floor(index * (simplified.length - 1) / (MAX_RENDER_POINTS - 1))]!);
}

function isSharpTurn(previous: Point, point: Point, next: Point): boolean {
  const before_x = point.x - previous.x;
  const before_y = point.y - previous.y;
  const after_x = next.x - point.x;
  const after_y = next.y - point.y;
  const denominator = Math.hypot(before_x, before_y) * Math.hypot(after_x, after_y);
  return denominator > 0 && (before_x * after_x + before_y * after_y) / denominator < 0.95;
}
