import { ManiaReplayBase } from "../replay/mania/ManiaReplayBase";
import { createOsuReplayBase } from "../replay/osu/OsuReplayBase";
import type { GameplayConfiguration } from "../gameplay/GameplayConfiguration";
import type { Config, ConfigSetting } from "./Config";
import { appSettings, settings } from "./Settings";

export interface GameplayModifiersController {
  readonly master_volume: number;
  readonly music_rate: number;
  readonly constant_scroll: boolean;
  readonly tap_only: boolean;
  readonly osu_overall_difficulty: number | null;
  readonly osu_circle_size: number | null;
  readonly osu_approach_rate: number | null;
  set_music_rate(value: number): void;
  set_constant_scroll(value: boolean): void;
  set_tap_only(value: boolean): void;
  set_osu_overall_difficulty(value: number | null): void;
  set_osu_circle_size(value: number | null): void;
  set_osu_approach_rate(value: number | null): void;
}

export interface GameplaySettingsSnapshot {
  readonly configuration: GameplayConfiguration;
  readonly modifiers: GameplayModifiersController;
  readonly online_server_address: string;
}

type Listener = () => void;

export class GameplaySettingsController {
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribers: (() => void)[];
  private snapshot: GameplaySettingsSnapshot;

  constructor(private readonly config: Config = appSettings) {
    this.snapshot = this.createSnapshot();
    this.unsubscribers = Object.values(settings).map((definition) =>
      this.config.subscribe(definition as ConfigSetting<unknown>, () => {
        this.snapshot = this.createSnapshot();
        for (const listener of this.listeners) listener();
      }));
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): GameplaySettingsSnapshot => this.snapshot;

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.listeners.clear();
  }

  private setOsuOverride(enabled: typeof settings.customize_osu_overall_difficulty,
    value_setting: typeof settings.osu_overall_difficulty, value: number | null): void {
    this.config.set(enabled, value !== null);
    if (value !== null) this.config.set(value_setting, value);
  }

  private createSnapshot(): GameplaySettingsSnapshot {
    const value = <T>(definition: Parameters<Config["get"]>[0]) => this.config.get(definition) as T;
    const music_rate = value<number>(settings.music_rate);
    const constant_scroll = value<boolean>(settings.constant_scroll);
    const tap_only = value<boolean>(settings.tap_only);
    const replay_base = new ManiaReplayBase();
    replay_base.rate = music_rate;
    replay_base.const = constant_scroll;
    replay_base.tap_only = tap_only;
    const osu_replay_base = {
      ...createOsuReplayBase(music_rate, value<boolean>(settings.customize_osu_overall_difficulty)
        ? value<number>(settings.osu_overall_difficulty) : 5),
      overall_difficulty: value<boolean>(settings.customize_osu_overall_difficulty)
        ? value<number>(settings.osu_overall_difficulty) : null,
      circle_size: value<boolean>(settings.customize_osu_circle_size) ? value<number>(settings.osu_circle_size) : null,
      approach_rate: value<boolean>(settings.customize_osu_approach_rate) ? value<number>(settings.osu_approach_rate) : null,
    };
    const configuration: GameplayConfiguration = {
      common: {
        master_volume: value<number>(settings.master_volume), music_offset: value<number>(settings.music_offset),
        hit_error_meter: { enabled: value<boolean>(settings.hit_error_meter),
          type: value(settings.hit_error_meter_type), scale: value<number>(settings.hit_error_meter_scale) },
      },
      mania: { scroll_speed: value<number>(settings.scroll_speed), replay_base,
        hit_registration: value(settings.mania_hit_registration) },
      osu: { hit_sound_volume: value<number>(settings.osu_hit_sound_volume), cursor_scale: value<number>(settings.cursor_scale),
        cursor_renderer: value(settings.osu_cursor_renderer), raw_input: value<boolean>(settings.osu_raw_input),
        replay_base: osu_replay_base },
    };
    return {
      configuration,
      online_server_address: value<string>(settings.online_server_address),
      modifiers: {
        master_volume: configuration.common.master_volume, music_rate, constant_scroll, tap_only,
        osu_overall_difficulty: osu_replay_base.overall_difficulty, osu_circle_size: osu_replay_base.circle_size,
        osu_approach_rate: osu_replay_base.approach_rate,
        set_music_rate: (next) => this.config.set(settings.music_rate, Math.round(next * 1000) / 1000),
        set_constant_scroll: (next) => this.config.set(settings.constant_scroll, next),
        set_tap_only: (next) => this.config.set(settings.tap_only, next),
        set_osu_overall_difficulty: (next) => this.setOsuOverride(settings.customize_osu_overall_difficulty,
          settings.osu_overall_difficulty, next),
        set_osu_circle_size: (next) => this.setOsuOverride(settings.customize_osu_circle_size, settings.osu_circle_size, next),
        set_osu_approach_rate: (next) => this.setOsuOverride(settings.customize_osu_approach_rate,
          settings.osu_approach_rate, next),
      },
    };
  }
}
