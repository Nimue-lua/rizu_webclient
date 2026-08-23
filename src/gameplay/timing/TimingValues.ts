export type TimingResult = "exactly" | "early" | "late" | "too early" | "too late";

export interface TimingWindow {
  hit: readonly [number, number];
  miss: readonly [number, number];
}

const TIME_EPSILON = 1e-9;

export function classifyTiming(window: TimingWindow, delta_time: number): TimingResult {
  if (delta_time >= window.hit[0] - TIME_EPSILON && delta_time <= window.hit[1] + TIME_EPSILON) return "exactly";
  if (delta_time >= window.miss[0] - TIME_EPSILON && delta_time < window.hit[0]) return "early";
  if (delta_time > window.hit[1] && delta_time <= window.miss[1] + TIME_EPSILON) return "late";
  return delta_time < window.miss[0] ? "too early" : "too late";
}
