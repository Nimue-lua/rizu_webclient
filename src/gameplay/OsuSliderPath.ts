import type { OsuSlider } from "../chart/Chart";
import type { Point } from "./OsuViewport";

const MAX_PATH_POINTS = 16_384;
const MAX_CURVE_WORK = 250_000;
const BEZIER_TOLERANCE_SQUARED = 0.25;
const CATMULL_DETAIL = 50;

interface MutablePoint { x: number; y: number }

class PathBudgetExceeded extends Error {}

class PathBuilder {
  readonly points: MutablePoint[] = [];
  work = 0;

  add(point: Point): void {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new PathBudgetExceeded();
    const previous = this.points.at(-1);
    if (previous?.x === point.x && previous.y === point.y) return;
    if (this.points.length >= MAX_PATH_POINTS) throw new PathBudgetExceeded();
    this.points.push({ x: point.x, y: point.y });
  }

  spend(amount: number): void {
    this.work += amount;
    if (this.work > MAX_CURVE_WORK) throw new PathBudgetExceeded();
  }
}

export class OsuSliderPath {
  readonly points: readonly Point[];
  readonly cumulative_lengths: Float64Array;
  readonly length: number;
  readonly degraded: boolean;

  private constructor(points: readonly Point[], degraded: boolean) {
    this.points = points;
    this.degraded = degraded;
    this.cumulative_lengths = new Float64Array(points.length);
    for (let index = 1; index < points.length; index += 1) {
      this.cumulative_lengths[index] = this.cumulative_lengths[index - 1]! + distance(points[index - 1]!, points[index]!);
    }
    this.length = this.cumulative_lengths.at(-1) ?? 0;
  }

  static create(slider: OsuSlider, format_version: number): OsuSliderPath {
    const controls = [{ x: slider.x, y: slider.y }, ...slider.control_points];
    let points: MutablePoint[];
    let degraded = false;
    try {
      points = flatten(slider, controls, format_version);
    } catch (reason) {
      if (!(reason instanceof PathBudgetExceeded)) throw reason;
      degraded = true;
      points = boundedControlPolygon(controls);
    }
    points = adjustLength(points, slider.pixel_length);
    if (points.length === 0) points = [{ x: slider.x, y: slider.y }];
    return new OsuSliderPath(points, degraded);
  }

  positionAtDistance(distance_value: number): Point {
    if (this.points.length === 1 || this.length === 0) return this.points[0]!;
    const target = Math.min(Math.max(Number.isFinite(distance_value) ? distance_value : 0, 0), this.length);
    let low = 1;
    let high = this.cumulative_lengths.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.cumulative_lengths[middle]! < target) low = middle + 1;
      else high = middle;
    }
    const start = this.points[low - 1]!;
    const end = this.points[low]!;
    const segment_start = this.cumulative_lengths[low - 1]!;
    const segment_length = this.cumulative_lengths[low]! - segment_start;
    const progress = segment_length > 0 ? (target - segment_start) / segment_length : 0;
    return lerp(start, end, progress);
  }

  positionAtProgress(progress: number): Point {
    return this.positionAtDistance(Math.min(Math.max(progress, 0), 1) * this.length);
  }

  endPosition(repeat_count: number): Point {
    return repeat_count % 2 === 0 ? this.points[0]! : this.points.at(-1)!;
  }
}

function flatten(slider: OsuSlider, controls: readonly Point[], format_version: number): MutablePoint[] {
  const builder = new PathBuilder();
  if (controls.length === 0) return [];
  if (slider.curve_type === "linear") flattenLinear(controls, builder);
  else if (slider.curve_type === "catmull") flattenCatmull(controls, builder);
  else if (slider.curve_type === "perfect" && controls.length === 3 && !collinear(controls[0]!, controls[1]!, controls[2]!)) {
    flattenPerfect(controls[0]!, controls[1]!, controls[2]!, builder);
  } else {
    flattenBezierParts(controls, format_version, builder);
  }
  return builder.points;
}

function flattenLinear(points: readonly Point[], builder: PathBuilder): void {
  for (const point of points) builder.add(point);
}

function flattenCatmull(points: readonly Point[], builder: PathBuilder): void {
  builder.add(points[0]!);
  for (let index = 0; index < points.length - 1; index += 1) {
    const p1 = points[index - 1] ?? points[index]!;
    const p2 = points[index]!;
    const p3 = points[index + 1] ?? subtract(scale(p2, 2), p1);
    const p4 = points[index + 2] ?? subtract(scale(p3, 2), p2);
    for (let step = 1; step <= CATMULL_DETAIL; step += 1) {
      builder.spend(1);
      builder.add(catmull(p1, p2, p3, p4, step / CATMULL_DETAIL));
    }
  }
}

function flattenBezierParts(points: readonly Point[], format_version: number, builder: PathBuilder): void {
  if (format_version <= 6) {
    let start = 0;
    for (let index = 0; index < points.length; index += 1) {
      if ((index > 0 && equal(points[index]!, points[index - 1]!)) || index === points.length - 1) {
        flattenBezier(points.slice(start, index + 1), false, builder);
        start = index;
      }
    }
    return;
  }
  let start = 0;
  for (let index = 0; index < points.length; index += 1) {
    if ((index < points.length - 2 && equal(points[index]!, points[index + 1]!)) || index === points.length - 1) {
      const part = points.slice(start, index + 1);
      if (format_version > 8 && part.length === 2) flattenLinear(part, builder);
      else flattenBezier(part, format_version === 9, builder);
      if (index < points.length - 1) index += 1;
      start = index;
    }
  }
}

function flattenBezier(points: readonly Point[], wrong: boolean, builder: PathBuilder): void {
  if (points.length === 0) return;
  if (wrong) {
    const samples = CATMULL_DETAIL * points.length;
    for (let index = 0; index < samples; index += 1) {
      builder.spend(points.length * points.length);
      builder.add(deCasteljau(points, index / samples));
    }
    return;
  }
  const stack: Point[][] = [[...points]];
  while (stack.length > 0) {
    const curve = stack.pop()!;
    builder.spend(curve.length * curve.length);
    if (flatEnough(curve)) {
      approximateBezier(curve, builder);
    } else {
      const [left, right] = subdivide(curve);
      stack.push(right, left);
    }
  }
  builder.add(points.at(-1)!);
}

function flatEnough(points: readonly Point[]): boolean {
  for (let index = 1; index < points.length - 1; index += 1) {
    const x = points[index - 1]!.x - 2 * points[index]!.x + points[index + 1]!.x;
    const y = points[index - 1]!.y - 2 * points[index]!.y + points[index + 1]!.y;
    if (x * x + y * y > BEZIER_TOLERANCE_SQUARED) return false;
  }
  return true;
}

function subdivide(points: readonly Point[]): [Point[], Point[]] {
  const working = points.map((point) => ({ ...point }));
  const left = [working[0]!];
  const right = [working.at(-1)!];
  for (let level = 1; level < points.length; level += 1) {
    for (let index = 0; index < points.length - level; index += 1) {
      working[index] = lerp(working[index]!, working[index + 1]!, 0.5);
    }
    left.push(working[0]!);
    right.push(working[points.length - level - 1]!);
  }
  right.reverse();
  return [left, right];
}

function approximateBezier(points: readonly Point[], builder: PathBuilder): void {
  const [left, right] = subdivide(points);
  const combined = [...left, ...right.slice(1)];
  builder.add(points[0]!);
  for (let index = 1; index < points.length - 1; index += 1) {
    const first = combined[index * 2 - 1]!;
    const middle = combined[index * 2]!;
    const last = combined[index * 2 + 1]!;
    builder.add({ x: (first.x + 2 * middle.x + last.x) / 4, y: (first.y + 2 * middle.y + last.y) / 4 });
  }
}

function deCasteljau(points: readonly Point[], progress: number): Point {
  const working = points.map((point) => ({ ...point }));
  for (let level = 1; level < points.length; level += 1) {
    for (let index = 0; index < points.length - level; index += 1) {
      working[index] = lerp(working[index]!, working[index + 1]!, progress);
    }
  }
  return working[0]!;
}

function flattenPerfect(first: Point, middle: Point, last: Point, builder: PathBuilder): void {
  const determinant = 2 * (first.x * (middle.y - last.y) + middle.x * (last.y - first.y) + last.x * (first.y - middle.y));
  const first_sq = first.x * first.x + first.y * first.y;
  const middle_sq = middle.x * middle.x + middle.y * middle.y;
  const last_sq = last.x * last.x + last.y * last.y;
  const center = {
    x: (first_sq * (middle.y - last.y) + middle_sq * (last.y - first.y) + last_sq * (first.y - middle.y)) / determinant,
    y: (first_sq * (last.x - middle.x) + middle_sq * (first.x - last.x) + last_sq * (middle.x - first.x)) / determinant,
  };
  const radius = distance(center, first);
  let start_angle = Math.atan2(first.y - center.y, first.x - center.x);
  let middle_angle = Math.atan2(middle.y - center.y, middle.x - center.x);
  let end_angle = Math.atan2(last.y - center.y, last.x - center.x);
  while (middle_angle < start_angle) middle_angle += Math.PI * 2;
  while (end_angle < start_angle) end_angle += Math.PI * 2;
  if (middle_angle > end_angle) end_angle -= Math.PI * 2;
  const segments = Math.max(1, Math.floor(Math.abs(end_angle - start_angle) * radius / 8));
  builder.spend(segments);
  for (let index = 0; index <= segments; index += 1) {
    const angle = start_angle + (end_angle - start_angle) * index / segments;
    builder.add({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
  }
}

function adjustLength(points: MutablePoint[], target_length: number): MutablePoint[] {
  if (points.length < 2 || target_length <= 0) return points.slice(0, 1);
  const result: MutablePoint[] = [{ ...points[0]! }];
  let remaining = target_length;
  for (let index = 1; index < points.length && remaining > 0; index += 1) {
    const start = result.at(-1)!;
    const end = points[index]!;
    const segment = distance(start, end);
    if (segment === 0) continue;
    if (segment >= remaining) {
      result.push(lerp(start, end, remaining / segment));
      remaining = 0;
    } else {
      result.push({ ...end });
      remaining -= segment;
    }
  }
  if (remaining > 0 && result.length > 1) {
    const end = result.at(-1)!;
    const previous = result.at(-2)!;
    const segment = distance(previous, end);
    result[result.length - 1] = {
      x: end.x + (end.x - previous.x) / segment * remaining,
      y: end.y + (end.y - previous.y) / segment * remaining,
    };
  }
  return result;
}

function boundedControlPolygon(points: readonly Point[]): MutablePoint[] {
  if (points.length <= MAX_PATH_POINTS) return points.map((point) => ({ ...point }));
  return Array.from({ length: MAX_PATH_POINTS }, (_, index) => ({
    ...points[Math.floor(index * (points.length - 1) / (MAX_PATH_POINTS - 1))]!,
  }));
}

function catmull(p1: Point, p2: Point, p3: Point, p4: Point, t: number): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (2 * p2.x + (-p1.x + p3.x) * t + (2 * p1.x - 5 * p2.x + 4 * p3.x - p4.x) * t2 + (-p1.x + 3 * p2.x - 3 * p3.x + p4.x) * t3),
    y: 0.5 * (2 * p2.y + (-p1.y + p3.y) * t + (2 * p1.y - 5 * p2.y + 4 * p3.y - p4.y) * t2 + (-p1.y + 3 * p2.y - 3 * p3.y + p4.y) * t3),
  };
}

function collinear(first: Point, middle: Point, last: Point): boolean {
  return (middle.x - first.x) * (last.y - first.y) === (middle.y - first.y) * (last.x - first.x);
}

function equal(first: Point, second: Point): boolean { return first.x === second.x && first.y === second.y; }
function distance(first: Point, second: Point): number { return Math.hypot(second.x - first.x, second.y - first.y); }
function lerp(first: Point, second: Point, progress: number): MutablePoint {
  return { x: first.x + (second.x - first.x) * progress, y: first.y + (second.y - first.y) * progress };
}
function scale(point: Point, value: number): MutablePoint { return { x: point.x * value, y: point.y * value }; }
function subtract(first: Point, second: Point): MutablePoint { return { x: first.x - second.x, y: first.y - second.y }; }
