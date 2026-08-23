import type { ChartInput } from "../chart/Chart";

export interface Chartview extends ChartInput {
  background_url: string | null;
  bpm_avg: number;
  bpm_max: number;
  bpm_min: number;
  creator: string;
  difficulty: number;
  duration_seconds: number;
  format: string;
  id: string;
  long_note_ratio: number;
  location_id: number;
  name: string;
  note_count: number;
}

export interface ChartfileSetView {
  charts: Chartview[];
  id: string;
  title: string;
  artist: string;
}

export interface Location {
  id: number;
  name: string;
}

export interface LibraryView {
  locations: Location[];
  songs: ChartfileSetView[];
}
