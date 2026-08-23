export interface Note {
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

export interface Chart {
  column_count: number;
  primary_tempo: number;
  notes: readonly Note[];
  visual_points: readonly VisualPoint[];
}

export interface ChartInput {
  mode: number;
  keys: number | null;
}
