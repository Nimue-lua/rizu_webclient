import type { TimingWindow } from "../gameplay/timing/TimingValues";

export interface Modifier {
  id: number;
  version: number;
  value?: number | string;
}

export interface NamedValue {
  name: string;
  data?: number;
}

export interface ReplayTimingValues {
  ShortNote: TimingWindow;
  LongNoteStart: TimingWindow;
  LongNoteEnd: TimingWindow;
}

export interface ReplayBaseValues {
  modifiers: Modifier[];
  rate: number;
  mode: "mania";
  nearest: boolean;
  tap_only: boolean;
  timings: NamedValue | null;
  subtimings: NamedValue | null;
  healths: NamedValue | null;
  columns_order: number[] | null;
  custom: boolean;
  const: boolean;
  rate_type: "linear" | "exp";
  timing_values: ReplayTimingValues;
}

const default_timing_window: TimingWindow = { hit: [-0.12, 0.12], miss: [-0.16, 0.12] };

export class ReplayBase implements ReplayBaseValues {
  modifiers: Modifier[] = [];
  rate = 1;
  mode = "mania" as const;
  nearest = false;
  tap_only = false;
  timings: NamedValue | null = { name: "sphere", data: 0 };
  subtimings: NamedValue | null = null;
  healths: NamedValue | null = null;
  columns_order: number[] | null = null;
  custom = false;
  const = false;
  rate_type = "linear" as const;
  timing_values: ReplayTimingValues = {
    ShortNote: default_timing_window,
    LongNoteStart: default_timing_window,
    LongNoteEnd: default_timing_window,
  };

  importReplayBase(values: ReplayBaseValues): void {
    Object.assign(this, values);
  }

  exportReplayBase(): ReplayBaseValues {
    return {
      modifiers: this.modifiers,
      rate: this.rate,
      mode: this.mode,
      nearest: this.nearest,
      tap_only: this.tap_only,
      timings: this.timings,
      subtimings: this.subtimings,
      healths: this.healths,
      columns_order: this.columns_order,
      custom: this.custom,
      const: this.const,
      rate_type: this.rate_type,
      timing_values: this.timing_values,
    };
  }
}
