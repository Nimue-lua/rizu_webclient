import type { DatabaseSync } from "node:sqlite";

export type JsonObject = Record<string, unknown>;

export interface UserRow {
  id: number;
  name: string;
}

export interface LoginRow extends UserRow {
  password_hash: string;
}

export interface ScoreRow {
  id: number;
  chart_md5: string;
  chart_index: number;
  user_id: number | null;
  user_name: string | null;
  mode: string;
  accuracy: number | null;
  score: number | null;
  played_at: string;
  submitted_at: string;
  metadata_json: string;
  comment: string | null;
  validation_state: string;
}

export interface CatalogChartRow {
  chart_path: string;
  background_preview_path: string | null;
  difficulty: number;
  speed: number | null;
  dexterity: number | null;
  stamina: number | null;
  technical: number | null;
  duration_seconds: number;
  mode: number;
  keys: number | null;
  name: string;
  title: string;
  artist: string;
}

export interface ReplayServerOptions {
  database_path?: string;
  database?: DatabaseSync;
  catalog_path?: string;
  catalog?: DatabaseSync;
  app_html?: string;
  app_directory?: string;
  asset_base_url?: string;
  replay_validator?: ReplayValidator;
}

export interface ReplayValidationInput {
  id: number;
  chart_md5: string;
  chart_index: number;
  mode: "mania" | "osu";
  replay: Uint8Array;
  replay_base: unknown;
}

export interface ReplayValidationResult {
  score: number;
  accuracy: number;
  music_rate: number;
  grade?: string | null;
  combo?: number | null;
  max_combo?: number | null;
  misses?: number;
  judges?: Readonly<Record<string, number>>;
}

export type ReplayValidator = (input: ReplayValidationInput) => Promise<ReplayValidationResult>;
