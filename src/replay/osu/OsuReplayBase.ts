import type { OsuStandardTimingValues } from "../../gameplay/osu/timing/OsuStandardOdTimings";
import { resolveOsuStandardTimingValues } from "../../gameplay/timing/TimingValuesFactory";
import { Timings, type TimingsValue } from "../../gameplay/timing/Timings";
import type { CommonReplayBaseValues } from "../ReplayBase";

export interface OsuReplayBaseValues extends CommonReplayBaseValues {
  mode: "osu";
  timings: TimingsValue;
  timing_values: OsuStandardTimingValues;
  x_flip: boolean;
  y_flip: boolean;
  approach_rate: number | null;
  circle_size: number | null;
  overall_difficulty: number | null;
}

export function createOsuReplayBase(rate = 1, overall_difficulty = 5): OsuReplayBaseValues {
  const timings = new Timings("osu_std_od", overall_difficulty);
  return {
    modifiers: [], rate, mode: "osu", custom: false, rate_type: "linear", x_flip: false, y_flip: false,
    timings: timings.toJSON(), timing_values: resolveOsuStandardTimingValues(timings).values,
    approach_rate: null, circle_size: null, overall_difficulty: null,
  };
}
