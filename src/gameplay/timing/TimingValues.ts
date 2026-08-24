export type TimingResult = "exactly" | "early" | "late" | "too early" | "too late";

export interface TimingWindow {
  hit: readonly [number, number];
  miss: readonly [number, number];
}

export interface TimingValues {
  ShortNote: TimingWindow;
  LongNoteStart: TimingWindow;
  LongNoteEnd: TimingWindow;
}

export function createSimpleTimingValues(hit: number, miss = hit): TimingValues {
  const createWindow = (): TimingWindow => ({ hit: [-hit, hit], miss: [-miss, miss] });
  return { ShortNote: createWindow(), LongNoteStart: createWindow(), LongNoteEnd: createWindow() };
}

export function timingValuesEqual(left: TimingValues, right: TimingValues): boolean {
  const names = ["ShortNote", "LongNoteStart", "LongNoteEnd"] as const;
  return names.every((name) => {
    const a = left[name];
    const b = right[name];
    return Math.abs(a.hit[0] - b.hit[0]) < 1e-9 && Math.abs(a.hit[1] - b.hit[1]) < 1e-9 &&
      Math.abs(a.miss[0] - b.miss[0]) < 1e-9 && Math.abs(a.miss[1] - b.miss[1]) < 1e-9;
  });
}

const TIME_EPSILON = 1e-9;

export function classifyTiming(window: TimingWindow, delta_time: number): TimingResult {
  if (delta_time >= window.hit[0] - TIME_EPSILON && delta_time <= window.hit[1] + TIME_EPSILON) return "exactly";
  if (delta_time >= window.miss[0] - TIME_EPSILON && delta_time < window.hit[0]) return "early";
  if (delta_time > window.hit[1] && delta_time <= window.miss[1] + TIME_EPSILON) return "late";
  return delta_time < window.miss[0] ? "too early" : "too late";
}
