export interface ManiaNoteEvent {
  column: number;
  absolute_time: number;
  weight: -1 | 0 | 1;
}

export interface VisualPoint {
  absolute_time: number;
  visual_time: number;
  current_speed: number;
  local_speed: number;
  global_speed: number;
}

export interface ManiaChart {
  mode: "mania";
  column_count: number;
  overall_difficulty?: number;
  primary_tempo: number;
  notes: readonly ManiaNoteEvent[];
  visual_points: readonly VisualPoint[];
}

export interface OsuCircle {
  x: number;
  y: number;
  absolute_time: number;
}

export interface OsuChart {
  mode: "osu";
  approach_rate: number;
  circle_size: number;
  end_time: number;
  overall_difficulty?: number;
  hp_drain_rate: number;
  object_count: number;
  drain_length_seconds: number;
  primary_tempo: number;
  circles: readonly OsuCircle[];
}

export type Chart = ManiaChart | OsuChart;

export interface ChartInput {
  mode: number;
  keys: number | null;
}
