import type { GameplayData, ManiaGameplayData, OsuGameplayData } from "../library/GameplayLoader";
import { ManiaReplayBase } from "../replay/mania/ManiaReplayBase";
import { createOsuReplayBase, type OsuReplayBaseValues } from "../replay/osu/OsuReplayBase";
import { Subtimings } from "./timing/Subtimings";
import { Timings } from "./timing/Timings";
import { normalizeOsuOd } from "./mania/timing/OsuManiaV2Timings";
import type { ManiaHitRegistration } from "./mania/ManiaRulesEngine";
import { ManiaGameplayRuntime } from "./mania/ManiaGameplayRuntime";
import { OsuGameplayRuntime } from "./osu/OsuGameplayRuntime";
import type { GameplaySession, GameplaySessionBinding, ManiaPointerInput, OsuPointerInput } from "./GameplaySession";
import type { ScoreResult } from "./scoring/ScoreResult";
import type { OsuSliderRendererMode } from "./osu/rendering/WebGlSliderGraphics";
import type { OsuCursorRendererMode } from "./osu/OsuHardwareCursor";

export interface GameplaySessionOptions {
  canvas: HTMLCanvasElement;
  data: GameplayData;
  master_volume: number;
  osu_hit_sound_volume: number;
  music_offset: number;
  scroll_speed: number;
  cursor_scale: number;
  osu_cursor_renderer: OsuCursorRendererMode;
  osu_slider_renderer: OsuSliderRendererMode;
  replay_base: ManiaReplayBase;
  input_bindings: readonly (string | null)[];
  hit_registration: ManiaHitRegistration;
  finish: (score: ScoreResult) => void;
}

export interface GameplaySessionFactoryDependencies {
  create_mania(options: GameplaySessionOptions & { data: ManiaGameplayData; replay_base: ManiaReplayBase }): GameplaySession & ManiaPointerInput;
  create_osu(options: Omit<GameplaySessionOptions, "replay_base"> &
    { data: OsuGameplayData; replay_base: OsuReplayBaseValues }): GameplaySession & OsuPointerInput;
}

const default_dependencies: GameplaySessionFactoryDependencies = {
  create_mania: (options) => new ManiaGameplayRuntime(options.canvas, options.data, options.master_volume,
    options.music_offset, options.scroll_speed, options.replay_base, options.input_bindings,
    options.hit_registration, options.finish),
  create_osu: (options) => new OsuGameplayRuntime(options.canvas, options.data, options.master_volume,
    options.osu_hit_sound_volume, options.music_offset, options.cursor_scale, options.osu_cursor_renderer, options.replay_base,
    options.osu_slider_renderer, options.input_bindings, options.finish),
};

export function createGameplaySession(options: GameplaySessionOptions,
  dependencies: GameplaySessionFactoryDependencies = default_dependencies): GameplaySessionBinding {
  if (options.data.mode === "mania") {
    const replay_base = new ManiaReplayBase();
    replay_base.importReplayBase(options.replay_base.exportReplayBase());
    replay_base.nearest = options.hit_registration === "nearest";
    replay_base.setTimingIdentity(new Timings("osuod", normalizeOsuOd(options.data.chart.overall_difficulty ?? 5)),
      new Subtimings("scorev", 2));
    const session = dependencies.create_mania({ ...options, data: options.data, replay_base });
    return { mode: "mania", session, pointer_input: session };
  }
  const { replay_base, ...common_options } = options;
  const session = dependencies.create_osu({
    ...common_options,
    data: options.data,
    replay_base: createOsuReplayBase(replay_base.rate,
      normalizeOsuOd(options.data.chart.overall_difficulty ?? 5)),
  });
  return { mode: "osu", session, pointer_input: session };
}
