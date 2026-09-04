import { useSyncExternalStore } from "react";
import type { ManiaHitRegistration } from "../gameplay/mania/ManiaRulesEngine";
import type { ScrollSpeedType } from "../gameplay/mania/ScrollSpeed";
import type { OsuCursorRendererMode } from "../gameplay/osu/OsuHardwareCursor";
import type { HitErrorMeterType } from "../gameplay/renderer/GameplayHudRenderer";
import {
  booleanSetting,
  choiceSetting,
  Config,
  type ConfigDefinition,
  type ConfigSetting,
  type ConfigStorage,
  numberSetting,
  stringSetting,
} from "./Config";

const STORAGE_KEY = "rizu.settings";

export type UserInterface = "default" | "windows-xp";

export const settings = {
  user_interface: choiceSetting<UserInterface>("ui", "default", ["default", "windows-xp"]),
  windows_xp_window_frames: stringSetting("ui.windows_xp.window_frames", "{}"),
  master_volume: numberSetting("audio.volume.master", 0.2, 0, 1, 0.01),
  osu_hit_sound_volume: numberSetting("audio.volume.osu_hit_sound", 1, 0, 1, 0.01),
  music_offset: numberSetting("gameplay.offset.music", 0, -200, 200, 1),
  scroll_speed: numberSetting("gameplay.scroll_speed", 1, 0.05, 3, 0.01),
  scroll_speed_type: choiceSetting<ScrollSpeedType>("gameplay.scroll_speed_type", "default", ["default", "osu"]),
  cursor_scale: numberSetting("gameplay.osu.cursor_scale", 1, 0.25, 2, 0.05),
  hit_error_meter: booleanSetting("renderer.hit_error_meter.enabled", true),
  hit_error_meter_type: choiceSetting<HitErrorMeterType>("renderer.hit_error_meter.type", "normal", ["normal", "fullscreen"]),
  hit_error_meter_scale: numberSetting("renderer.hit_error_meter.scale", 1, 0.5, 2, 0.05),
  osu_cursor_renderer: choiceSetting<OsuCursorRendererMode>("renderer.osu.cursor", "os", ["os", "webgl"]),
  osu_raw_input: booleanSetting("gameplay.osu.raw_input", true),
  mania_hit_registration: choiceSetting<ManiaHitRegistration>("gameplay.mania.hit_registration", "earliest", ["earliest", "nearest"]),
  music_rate: numberSetting("gameplay.music_rate", 1, 0.25, 4, 0.001),
  constant_scroll: booleanSetting("gameplay.mania.constant_scroll", false),
  tap_only: booleanSetting("gameplay.mania.tap_only", false),
  customize_osu_overall_difficulty: booleanSetting("gameplay.osu.customize_overall_difficulty", false),
  osu_overall_difficulty: numberSetting("gameplay.osu.overall_difficulty", 5, 0, 12, 0.1),
  customize_osu_circle_size: booleanSetting("gameplay.osu.customize_circle_size", false),
  osu_circle_size: numberSetting("gameplay.osu.circle_size", 5, 0, 12, 0.1),
  customize_osu_approach_rate: booleanSetting("gameplay.osu.customize_approach_rate", false),
  osu_approach_rate: numberSetting("gameplay.osu.approach_rate", 5, -10, 12, 0.1),
  online_server_address: stringSetting("online.server_address", ""),
} as const;

const definitions: readonly ConfigDefinition[] = Object.values(settings);

function browserStorage(): ConfigStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function createSettingsConfig(storage?: ConfigStorage): Config {
  const config = new Config(STORAGE_KEY, definitions, storage);
  config.load();
  return config;
}

export const appSettings = createSettingsConfig(browserStorage());

export function useSetting<T>(definition: ConfigSetting<T>): T {
  return useSyncExternalStore(
    (listener) => appSettings.subscribe(definition, listener),
    () => appSettings.get(definition) as T,
    () => definition.default,
  );
}
