import type { Point } from "../OsuViewport";
import type { OsuSliderPath } from "../OsuSliderPath";

const MAX_RENDER_POINTS = 2_048;
const RENDER_POINT_DISTANCE = 6;
const VERTEX_FLOATS = 6;

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
  const vertex = (x: number, y: number, start: Point, end: Point) => {
    vertices.push(x, y, start.x, start.y, end.x, end.y);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  };

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const direction_x = end.x - start.x;
    const direction_y = end.y - start.y;
    const length = Math.hypot(direction_x, direction_y);
    if (length === 0) continue;
    const along_x = direction_x / length * radius;
    const along_y = direction_y / length * radius;
    const normal_x = -direction_y / length * radius;
    const normal_y = direction_x / length * radius;
    const base = vertices.length / VERTEX_FLOATS;
    vertex(start.x - along_x + normal_x, start.y - along_y + normal_y, start, end);
    vertex(start.x - along_x - normal_x, start.y - along_y - normal_y, start, end);
    vertex(end.x + along_x + normal_x, end.y + along_y + normal_y, start, end);
    vertex(end.x + along_x - normal_x, end.y + along_y - normal_y, start, end);
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }

  if (vertices.length === 0) {
    const point = path.points[0]!;
    const base = vertices.length / VERTEX_FLOATS;
    vertex(point.x - radius, point.y - radius, point, point);
    vertex(point.x + radius, point.y - radius, point, point);
    vertex(point.x - radius, point.y + radius, point, point);
    vertex(point.x + radius, point.y + radius, point, point);
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    bounds: { left, top, right, bottom },
  };
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
