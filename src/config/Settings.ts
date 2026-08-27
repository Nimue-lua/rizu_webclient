import { useSyncExternalStore } from "react";
import type { ManiaHitRegistration } from "../gameplay/mania/ManiaRulesEngine";
import type { ScrollSpeedType } from "../gameplay/mania/ScrollSpeed";
import type { OsuCursorRendererMode } from "../gameplay/osu/OsuHardwareCursor";
import type { OsuSliderRendererMode } from "../gameplay/osu/rendering/WebGlSliderGraphics";
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

export const settings = {
  nickname: stringSetting("online.nickname", "Anonymous"),
  master_volume: numberSetting("audio.volume.master", 0.2, 0, 1, 0.01),
  osu_hit_sound_volume: numberSetting("audio.volume.osu_hit_sound", 1, 0, 1, 0.01),
  music_offset: numberSetting("gameplay.offset.music", 0, -200, 200, 1),
  scroll_speed: numberSetting("gameplay.scroll_speed", 1, 0.05, 3, 0.01),
  scroll_speed_type: choiceSetting<ScrollSpeedType>("gameplay.scroll_speed_type", "default", ["default", "osu"]),
  cursor_scale: numberSetting("gameplay.osu.cursor_scale", 1, 0.25, 2, 0.05),
  osu_cursor_renderer: choiceSetting<OsuCursorRendererMode>("renderer.osu.cursor", "os", ["os", "webgl"]),
  osu_raw_input: booleanSetting("gameplay.osu.raw_input", true),
  osu_slider_renderer: choiceSetting<OsuSliderRendererMode>("renderer.osu.slider", "direct", ["direct", "stable"]),
  hit_registration: choiceSetting<ManiaHitRegistration>("gameplay.mania.hit_registration", "earliest", ["earliest", "nearest"]),
  music_rate: numberSetting("gameplay.music_rate", 1, 0.25, 4, 0.001),
  constant_scroll: booleanSetting("gameplay.mania.constant_scroll", false),
  tap_only: booleanSetting("gameplay.mania.tap_only", false),
} as const;

const definitions: readonly ConfigDefinition[] = Object.values(settings);

const legacy_keys: Readonly<Record<keyof typeof settings, string>> = {
  nickname: "rizu.nickname",
  master_volume: "rizu.master-volume",
  osu_hit_sound_volume: "rizu.osu-hit-sound-volume",
  music_offset: "rizu.music-offset",
  scroll_speed: "rizu.scroll-speed",
  scroll_speed_type: "rizu.scroll-speed-type",
  cursor_scale: "rizu.cursor-scale",
  osu_cursor_renderer: "rizu.osu-cursor-renderer",
  osu_raw_input: "rizu.osu-raw-input",
  osu_slider_renderer: "rizu.osu-slider-renderer",
  hit_registration: "rizu.hit-registration",
  music_rate: "rizu.music-rate",
  constant_scroll: "rizu.constant-scroll-speed",
  tap_only: "rizu.no-long-notes",
};

function browserStorage(): ConfigStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function createSettingsConfig(storage?: ConfigStorage): Config {
  const config = new Config(STORAGE_KEY, definitions, storage);
  if (!config.load()) migrateLegacySettings(config, storage);
  return config;
}

function migrateLegacySettings(config: Config, storage?: ConfigStorage): void {
  if (!storage) return;
  const migrated: Record<string, unknown> = {};
  for (const [name, legacy_key] of Object.entries(legacy_keys) as [keyof typeof settings, string][]) {
    let serialized: string | null;
    try {
      serialized = storage.getItem(legacy_key);
    } catch {
      return;
    }
    if (serialized === null) continue;
    const definition = settings[name];
    const value: unknown = definition.kind === "number" ? Number(serialized)
      : definition.kind === "boolean" ? serialized === "true"
      : serialized;
    if (definition.isValid(value)) migrated[definition.key] = value;
  }
  if (!config.import(migrated)) return;
  for (const legacy_key of Object.values(legacy_keys)) {
    try {
      storage.removeItem(legacy_key);
    } catch {
      return;
    }
  }
}

export const appSettings = createSettingsConfig(browserStorage());

export function useSetting<T>(definition: ConfigSetting<T>): T {
  return useSyncExternalStore(
    (listener) => appSettings.subscribe(definition, listener),
    () => appSettings.get(definition) as T,
    () => definition.default,
  );
}
