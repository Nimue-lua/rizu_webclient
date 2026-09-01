import type { GameplayData, ManiaGameplayData, OsuGameplayData } from "../library/GameplayLoader";
import { ManiaReplayBase } from "../replay/mania/ManiaReplayBase";
import { createOsuReplayBase, type OsuReplayBaseValues } from "../replay/osu/OsuReplayBase";
import { Subtimings } from "./timing/Subtimings";
import { Timings } from "./timing/Timings";
import { normalizeOsuOd } from "./mania/timing/OsuManiaV2Timings";
import type { ManiaHitRegistration } from "./mania/ManiaRulesEngine";
import { ManiaGameplayRuntime } from "./mania/ManiaGameplayRuntime";
import { OsuGameplayRuntime } from "./osu/OsuGameplayRuntime";
import type { GameplayBackgroundState, GameplaySession, GameplaySessionBinding, ManiaPointerInput, OsuPointerInput } from "./GameplaySession";
import type { CompletedGameplay, ManiaRecordedReplay, OsuRecordedReplay } from "../replay/RecordedReplay";
import type { OsuCursorRendererMode } from "./osu/OsuHardwareCursor";
import { createManiaAutoplayReplay, createOsuAutoplayReplay } from "./AutoplayReplay";
import { applyOsuHitObjectStacking } from "./osu/OsuHitObjectStacking";
import type { GameplayPerformanceSample } from "./GameplayPerformance";

export interface GameplaySessionOptions {
  canvas: HTMLCanvasElement;
  data: GameplayData;
  master_volume: number;
  osu_hit_sound_volume: number;
  music_offset: number;
  scroll_speed: number;
  cursor_scale: number;
  hit_error_meter: boolean;
  hit_error_meter_scale: number;
  osu_cursor_renderer: OsuCursorRendererMode;
  replay_base: ManiaReplayBase;
  input_bindings: readonly (string | null)[];
  hit_registration: ManiaHitRegistration;
  initial_lead_in?: number;
  autoplay?: boolean;
  playback?: CompletedGameplay;
  finish: (completed: CompletedGameplay, reached_chart_end: boolean) => void;
  background_state_change?: (state: GameplayBackgroundState) => void;
  performance_sample?: (sample: GameplayPerformanceSample) => void;
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
    options.music_offset, options.scroll_speed, options.hit_error_meter, options.hit_error_meter_scale,
    options.replay_base, options.input_bindings,
    options.hit_registration, options.finish, undefined, options.playback_replay, options.initial_lead_in,
    options.background_state_change, options.performance_sample),
  create_osu: (options) => new OsuGameplayRuntime(options.canvas, options.data, options.master_volume,
    options.osu_hit_sound_volume, options.music_offset, options.cursor_scale, options.osu_cursor_renderer,
    options.hit_error_meter, options.hit_error_meter_scale, options.replay_base,
    options.input_bindings, options.finish, undefined, options.playback_replay, options.initial_lead_in,
    options.background_state_change, options.performance_sample),
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
    const playback_replay = options.playback?.replay.mode === "mania" ? options.playback.replay
      : options.autoplay ? createManiaAutoplayReplay(options.data.chart, replay_base.tap_only) : undefined;
    const session = dependencies.create_mania({ ...options, data: options.data, replay_base,
      hit_registration: replay_base.nearest ? "nearest" : "earliest", playback_replay });
    return { mode: "mania", session, pointer_input: session };
  }
  const { replay_base, ...common_options } = options;
  const osu_replay_base = options.playback?.replay_base.mode === "osu"
    ? options.playback.replay_base
    : createOsuReplayBase(replay_base.rate, normalizeOsuOd(options.data.chart.overall_difficulty ?? 5));
  const playback_replay = options.playback?.replay.mode === "osu" ? options.playback.replay
    : options.autoplay ? createOsuAutoplayReplay(applyOsuHitObjectStacking(options.data.chart,
      osu_replay_base.approach_rate ?? options.data.chart.approach_rate,
      osu_replay_base.circle_size ?? options.data.chart.circle_size)) : undefined;
  const session = dependencies.create_osu({
    ...common_options,
    data: options.data,
    osu_cursor_renderer: playback_replay ? "webgl" : options.osu_cursor_renderer,
    replay_base: osu_replay_base,
    playback_replay,
  });
  return { mode: "osu", session, pointer_input: session };
}
