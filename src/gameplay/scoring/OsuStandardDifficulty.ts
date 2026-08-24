function roundToEven(value: number): number {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (fraction < 0.5) return lower;
  if (fraction > 0.5) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}

export function calculateOsuStandardDifficultyMultiplier(hp: number, od: number, cs: number,
  object_count: number, drain_length_seconds: number): number {
  const density = drain_length_seconds <= 0 ? 16 : Math.min(16, Math.max(0,
    Math.fround(Math.fround(object_count) / Math.fround(drain_length_seconds) * Math.fround(8))));
  return roundToEven((hp + od + cs + density) / 38 * 5);
}
