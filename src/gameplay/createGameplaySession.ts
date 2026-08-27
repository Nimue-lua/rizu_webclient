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
import type { CompletedGameplay, ManiaRecordedReplay, OsuRecordedReplay } from "../replay/RecordedReplay";
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
  playback?: CompletedGameplay;
  finish: (completed: CompletedGameplay) => void;
}

export interface GameplaySessionFactoryDependencies {
  create_mania(options: GameplaySessionOptions & { data: ManiaGameplayData; replay_base: ManiaReplayBase;
    playback_replay?: ManiaRecordedReplay }): GameplaySession & ManiaPointerInput;
  create_osu(options: Omit<GameplaySessionOptions, "replay_base"> &
    { data: OsuGameplayData; replay_base: OsuReplayBaseValues;
      playback_replay?: OsuRecordedReplay }): GameplaySession & OsuPointerInput;
}

const default_dependencies: GameplaySessionFactoryDependencies = {
  create_mania: (options) => new ManiaGameplayRuntime(options.canvas, options.data, options.master_volume,
    options.music_offset, options.scroll_speed, options.replay_base, options.input_bindings,
    options.hit_registration, options.finish, undefined, options.playback_replay),
  create_osu: (options) => new OsuGameplayRuntime(options.canvas, options.data, options.master_volume,
    options.osu_hit_sound_volume, options.music_offset, options.cursor_scale, options.osu_cursor_renderer, options.replay_base,
    options.osu_slider_renderer, options.input_bindings, options.finish, undefined, options.playback_replay),
};

export function createGameplaySession(options: GameplaySessionOptions,
  dependencies: GameplaySessionFactoryDependencies = default_dependencies): GameplaySessionBinding {
  if (options.playback && (options.playback.replay.mode !== options.data.mode ||
    options.playback.replay_base.mode !== options.data.mode)) {
    throw new Error("Replay mode does not match gameplay mode");
  }
  if (options.data.mode === "mania") {
    const replay_base = new ManiaReplayBase();
    if (options.playback?.replay_base.mode === "mania") {
      replay_base.importReplayBase(options.playback.replay_base);
    } else {
      replay_base.importReplayBase(options.replay_base.exportReplayBase());
      replay_base.nearest = options.hit_registration === "nearest";
      replay_base.setTimingIdentity(new Timings("osuod", normalizeOsuOd(options.data.chart.overall_difficulty ?? 5)),
        new Subtimings("scorev", 2));
    }
    const playback_replay = options.playback?.replay.mode === "mania" ? options.playback.replay : undefined;
    const session = dependencies.create_mania({ ...options, data: options.data, replay_base,
      hit_registration: replay_base.nearest ? "nearest" : "earliest", playback_replay });
    return { mode: "mania", session, pointer_input: session };
  }
  const { replay_base, ...common_options } = options;
  const playback_replay = options.playback?.replay.mode === "osu" ? options.playback.replay : undefined;
  const osu_replay_base = options.playback?.replay_base.mode === "osu"
    ? options.playback.replay_base
    : createOsuReplayBase(replay_base.rate, normalizeOsuOd(options.data.chart.overall_difficulty ?? 5));
  const session = dependencies.create_osu({
    ...common_options,
    data: options.data,
    osu_cursor_renderer: playback_replay ? "webgl" : options.osu_cursor_renderer,
    replay_base: osu_replay_base,
    playback_replay,
  });
  return { mode: "osu", session, pointer_input: session };
}
