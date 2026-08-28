import type { ChartInput } from "../chart/Chart";

export interface Chartview extends ChartInput {
  audio_url: string;
  audio_preview_url: string;
  background_url: string | null;
  bpm_avg: number;
  bpm_max: number;
  bpm_min: number;
  creator: string;
  chart_url: string;
  difficulty: number;
  duration_seconds: number;
  format: string;
  id: string;
  long_note_ratio: number;
  location_id: number;
  name: string;
  note_count: number;
  source_id?: string;
  audio_path?: string;
  background_path?: string;
  chart_path?: string;
  preview_time?: number;
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
