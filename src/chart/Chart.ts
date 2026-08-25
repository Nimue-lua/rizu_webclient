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

export interface OsuHitSample {
  readonly normal_set: number;
  readonly addition_set: number;
  readonly index: number;
  readonly volume: number;
  readonly filename: string;
}

interface OsuHitObjectBase {
  readonly x: number;
  readonly y: number;
  readonly absolute_time: number;
  readonly hit_sound: number;
  readonly hit_sample: OsuHitSample;
}

export interface OsuCircle extends OsuHitObjectBase {
  readonly kind: "circle";
}

export type OsuSliderCurveType = "linear" | "bezier" | "perfect" | "catmull";

export interface OsuSliderEdgeSet {
  readonly normal_set: number;
  readonly addition_set: number;
}

export interface OsuSlider extends OsuHitObjectBase {
  readonly kind: "slider";
  readonly curve_type: OsuSliderCurveType;
  readonly control_points: readonly Readonly<{ x: number; y: number }>[];
  /** The .osu repeat field is the number of spans, including the first span. */
  readonly repeat_count: number;
  readonly pixel_length: number;
  readonly edge_sounds: readonly number[];
  readonly edge_sets: readonly OsuSliderEdgeSet[];
  readonly span_duration: number;
  readonly total_duration: number;
  readonly end_time: number;
  readonly tick_distances: readonly number[];
}

export interface OsuSpinner extends OsuHitObjectBase {
  readonly kind: "spinner";
  readonly end_time: number;
}

export type OsuHitObject = OsuCircle | OsuSlider | OsuSpinner;

export interface OsuTimingPoint {
  readonly absolute_time: number;
  readonly beat_length: number;
  readonly uninherited: boolean;
  readonly slider_velocity: number;
}

export interface OsuChart {
  mode: "osu";
  format_version: number;
  approach_rate: number;
  circle_size: number;
  end_time: number;
  overall_difficulty?: number;
  hp_drain_rate: number;
  object_count: number;
  drain_length_seconds: number;
  primary_tempo: number;
  slider_multiplier: number;
  slider_tick_rate: number;
  timing_points: readonly OsuTimingPoint[];
  hit_objects: readonly OsuHitObject[];
}

export type Chart = ManiaChart | OsuChart;

export interface ChartInput {
  mode: number;
  keys: number | null;
}
