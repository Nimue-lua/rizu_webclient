import type { VisualPoint } from "./Chart";

export interface TimingChange {
  time: number;
  bpm?: number;
  scroll_velocity?: number;
}

export function createVisualPoints(changes: readonly TimingChange[], primary_tempo = 120): VisualPoint[] {
  const changes_by_time = new Map<number, TimingChange>();
  for (const change of changes) {
    const existing = changes_by_time.get(change.time);
    changes_by_time.set(change.time, { ...existing, ...change });
  }

  const change_times = [...changes_by_time.keys()].sort((left, right) => left - right);
  const times = [...new Set([0, ...change_times])].sort((left, right) => left - right);
  const points: VisualPoint[] = [];
  const first_change = changes_by_time.get(change_times[0] ?? Number.NaN);
  let bpm = first_change?.bpm ?? 120;
  let scroll_velocity = first_change?.scroll_velocity ?? 1;
  let visual_time = 0;
  let previous_time = times[0] ?? 0;

  for (const time of times) {
    visual_time += (time - previous_time) * scroll_velocity * bpm / primary_tempo;
    const change = changes_by_time.get(time);
    if (change?.bpm !== undefined) bpm = change.bpm;
    if (change?.scroll_velocity !== undefined) scroll_velocity = change.scroll_velocity;
    points.push({
      absolute_time: time,
      visual_time,
      current_speed: scroll_velocity * bpm / primary_tempo,
      local_speed: 1,
      global_speed: 1,
    });
    previous_time = time;
  }

  const zero_visual_time = interpolateVisualPoint(points, 0).visual_time;
  for (const point of points) point.visual_time -= zero_visual_time;
  return points;
}

export function interpolateVisualPoint(points: readonly VisualPoint[], absolute_time: number): VisualPoint {
  if (points.length === 0) {
    return { absolute_time, visual_time: absolute_time, current_speed: 1, local_speed: 1, global_speed: 1 };
  }

  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (points[middle]!.absolute_time <= absolute_time) low = middle + 1;
    else high = middle;
  }

  const point = points[Math.max(0, low - 1)]!;
  return {
    absolute_time,
    visual_time: point.visual_time + (absolute_time - point.absolute_time) * point.current_speed,
    current_speed: point.current_speed,
    local_speed: point.local_speed,
    global_speed: point.global_speed,
  };
}
