export interface OsuStandardTimingValues {
  hit_300: number;
  hit_100: number;
  hit_50: number;
  early_miss: number;
  late_miss: number;
}

export function createOsuStandardTimingValues(od: number): OsuStandardTimingValues {
  const hit_300 = Math.trunc(80 - 6 * od) / 1000;
  const hit_100 = Math.trunc(140 - 8 * od) / 1000;
  const hit_50 = Math.trunc(200 - 10 * od) / 1000;
  return {
    hit_300,
    hit_100,
    hit_50,
    early_miss: 0.4,
    late_miss: hit_50,
  };
}
