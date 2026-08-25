import type { Point } from "../OsuViewport";
import type { OsuSliderPath } from "../OsuSliderPath";

const CIRCLE_SEGMENTS = 16;
const MAX_RENDER_POINTS = 2_048;
const RENDER_POINT_DISTANCE = 6;
const VERTEX_FLOATS = 3;

export interface OsuSliderMeshData {
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly bounds: Readonly<{ left: number; top: number; right: number; bottom: number }>;
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

  const strip_points = points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)]!;
    const next = points[Math.min(points.length - 1, index + 1)]!;
    const before = unitNormal(previous, point, point, next);
    const after = unitNormal(point, next, previous, point);
    let normal_x = before.x + after.x;
    let normal_y = before.y + after.y;
    const normal_length = Math.hypot(normal_x, normal_y);
    if (normal_length === 0) {
      normal_x = after.x || before.x;
      normal_y = after.y || before.y;
    } else {
      normal_x /= normal_length;
      normal_y /= normal_length;
    }
    const projection = Math.max(0.5, Math.abs(normal_x * after.x + normal_y * after.y));
    const scale = Math.min(radius / projection, radius * 2);
    return { point, normal_x: normal_x * scale, normal_y: normal_y * scale };
  });
  for (const { point, normal_x, normal_y } of strip_points) {
    vertex(point.x + normal_x, point.y + normal_y, 1);
    vertex(point.x, point.y, 0);
    vertex(point.x - normal_x, point.y - normal_y, 1);
  }
  for (let index = 1; index < strip_points.length; index += 1) {
    const base = (index - 1) * 3;
    const next = index * 3;
    indices.push(base, base + 1, next, next, base + 1, next + 1,
      base + 1, base + 2, next + 1, next + 1, base + 2, next + 2);
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
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices), bounds: { left, top, right, bottom } };
}

function unitNormal(start: Point, end: Point, fallback_start: Point, fallback_end: Point): Point {
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  let length = Math.hypot(dx, dy);
  if (length === 0) {
    dx = fallback_end.x - fallback_start.x;
    dy = fallback_end.y - fallback_start.y;
    length = Math.hypot(dx, dy);
  }
  return length > 0 ? { x: -dy / length, y: dx / length } : { x: 0, y: 0 };
}

function simplify(points: readonly Point[]): Point[] {
  if (points.length <= 2) return [...points];
  const simplified = [points[0]!];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified.at(-1)!;
    const point = points[index]!;
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= RENDER_POINT_DISTANCE) simplified.push(point);
  }
  simplified.push(points.at(-1)!);
  if (simplified.length <= MAX_RENDER_POINTS) return simplified;
  return Array.from({ length: MAX_RENDER_POINTS }, (_, index) =>
    simplified[Math.floor(index * (simplified.length - 1) / (MAX_RENDER_POINTS - 1))]!);
}
