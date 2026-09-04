import type { ManiaReplayBase } from "../replay/mania/ManiaReplayBase";
import type { OsuReplayBaseValues } from "../replay/osu/OsuReplayBase";
import type { ManiaHitRegistration } from "./mania/ManiaRulesEngine";
import type { OsuCursorRendererMode } from "./osu/OsuHardwareCursor";
import type { HitErrorMeterOptions } from "./renderer/GameplayHudRenderer";

export interface CommonGameplayConfiguration {
  master_volume: number;
  music_offset: number;
  hit_error_meter: HitErrorMeterOptions;
}

export interface ManiaGameplayConfiguration {
  scroll_speed: number;
  replay_base: ManiaReplayBase;
  hit_registration: ManiaHitRegistration;
}

export interface OsuGameplayConfiguration {
  hit_sound_volume: number;
  cursor_scale: number;
  cursor_renderer: OsuCursorRendererMode;
  raw_input: boolean;
  replay_base: OsuReplayBaseValues;
}

export interface GameplayConfiguration {
  common: CommonGameplayConfiguration;
  mania: ManiaGameplayConfiguration;
  osu: OsuGameplayConfiguration;
}

export type ManiaRuntimeConfiguration = CommonGameplayConfiguration & ManiaGameplayConfiguration;
export type OsuRuntimeConfiguration = CommonGameplayConfiguration & OsuGameplayConfiguration;
