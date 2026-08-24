import { resolveTimingValues } from "../gameplay/timing/TimingValuesFactory";
import { Subtimings, type SubtimingsValue } from "../gameplay/timing/Subtimings";
import { Timings, type TimingsValue } from "../gameplay/timing/Timings";
import { timingValuesEqual, type TimingValues } from "../gameplay/timing/TimingValues";
import { resolveOsuStandardTimingValues } from "../gameplay/timing/TimingValuesFactory";
import type { OsuStandardTimingValues } from "../gameplay/timing/OsuStandardOdTimings";

export interface Modifier {
  id: number;
  version: number;
  value?: number | string;
}

export interface NamedValue {
  name: string;
  data?: number;
}

interface CommonReplayBaseValues {
  modifiers: Modifier[];
  rate: number;
  custom: boolean;
  rate_type: "linear" | "exp";
}

export interface ManiaReplayBaseValues extends CommonReplayBaseValues {
  mode: "mania";
  nearest: boolean;
  tap_only: boolean;
  timings: TimingsValue;
  subtimings: SubtimingsValue | null;
  healths: NamedValue | null;
  columns_order: number[] | null;
  const: boolean;
  timing_values: TimingValues;
}

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

export type ReplayBaseValues = ManiaReplayBaseValues | OsuReplayBaseValues;

function cloneTimingValues(values: TimingValues): TimingValues {
  const clone = (window: TimingValues["ShortNote"]) => ({
    hit: [window.hit[0], window.hit[1]] as const,
    miss: [window.miss[0], window.miss[1]] as const,
  });
  return { ShortNote: clone(values.ShortNote), LongNoteStart: clone(values.LongNoteStart), LongNoteEnd: clone(values.LongNoteEnd) };
}

export class ReplayBase {
  modifiers: Modifier[] = [];
  rate = 1;
  readonly mode = "mania" as const;
  nearest = false;
  tap_only = false;
  timings = new Timings("sphere");
  subtimings: Subtimings | null = null;
  healths: NamedValue | null = null;
  columns_order: number[] | null = null;
  custom = false;
  const = false;
  rate_type: "linear" | "exp" = "linear";
  timing_values: TimingValues = resolveTimingValues(this.timings, this.subtimings).values;

  importReplayBase(values: ManiaReplayBaseValues): void {
    if (values.mode !== "mania") throw new Error("Cannot import non-mania values into ReplayBase");
    const timings = Timings.fromValue(values.timings);
    const subtimings = values.subtimings === null ? null : Subtimings.fromValue(values.subtimings);
    const canonical = resolveTimingValues(timings, subtimings).values;
    if (!timingValuesEqual(values.timing_values, canonical)) throw new Error("timing_values do not match timing identity");
    this.modifiers = values.modifiers.map((modifier) => ({ ...modifier }));
    this.rate = values.rate;
    this.nearest = values.nearest;
    this.tap_only = values.tap_only;
    this.timings = timings;
    this.subtimings = subtimings;
    this.healths = values.healths === null ? null : { ...values.healths };
    this.columns_order = values.columns_order === null ? null : [...values.columns_order];
    this.custom = values.custom;
    this.const = values.const;
    this.rate_type = values.rate_type;
    this.timing_values = cloneTimingValues(canonical);
  }

  setTimingIdentity(timings: Timings, subtimings: Subtimings | null): void {
    this.timings = timings;
    this.subtimings = subtimings;
    this.timing_values = cloneTimingValues(resolveTimingValues(timings, subtimings).values);
  }

  exportReplayBase(): ManiaReplayBaseValues {
    return {
      modifiers: this.modifiers.map((modifier) => ({ ...modifier })), rate: this.rate, mode: this.mode,
      nearest: this.nearest, tap_only: this.tap_only, timings: this.timings.toJSON(),
      subtimings: this.subtimings?.toJSON() ?? null, healths: this.healths === null ? null : { ...this.healths },
      columns_order: this.columns_order === null ? null : [...this.columns_order], custom: this.custom,
      const: this.const, rate_type: this.rate_type, timing_values: cloneTimingValues(this.timing_values),
    };
  }
}

export function createOsuReplayBase(rate = 1, overall_difficulty = 5): OsuReplayBaseValues {
  const timings = new Timings("osu_std_od", overall_difficulty);
  return {
    modifiers: [], rate, mode: "osu", custom: false, rate_type: "linear", x_flip: false, y_flip: false,
    timings: timings.toJSON(), timing_values: resolveOsuStandardTimingValues(timings).values,
    approach_rate: null, circle_size: null, overall_difficulty: null,
  };
}
