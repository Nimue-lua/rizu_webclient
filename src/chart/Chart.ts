export interface Note {
  column: number;
  start_time: number;
  end_time?: number;
}

export interface Chart {
  column_count: number;
  notes: readonly Note[];
}

export interface ChartInput {
  mode: number;
  keys: number | null;
}
