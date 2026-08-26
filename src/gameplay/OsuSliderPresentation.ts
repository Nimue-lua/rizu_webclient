import type { Point } from "./OsuViewport";

export interface OsuSliderPresentationState {
  readonly object_index: number;
  readonly position: Point;
  readonly active: boolean;
  readonly tracking: boolean;
  readonly tracking_started_at: number | null;
  readonly head_resolved_at: number;
  readonly head_successful: boolean;
}

export interface OsuSpinnerPresentationState {
  readonly object_index: number;
  readonly progress: number;
  readonly duration_progress: number;
  readonly rotation_radians: number;
  readonly rpm: number;
  readonly opacity: number;
  readonly fade_in_progress: number;
  readonly active: boolean;
}
