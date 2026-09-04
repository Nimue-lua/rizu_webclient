import type { GameplayData } from "../library/GameplayLoader";
import { ManiaReplayBase } from "../replay/mania/ManiaReplayBase";
import { createOsuReplayBase } from "../replay/osu/OsuReplayBase";
import { Subtimings } from "./timing/Subtimings";
import { Timings } from "./timing/Timings";
import { normalizeOsuOd } from "./mania/timing/OsuManiaV2Timings";
import { ManiaGameplayRuntime, type ManiaGameplayRuntimeOptions } from "./mania/ManiaGameplayRuntime";
import { OsuGameplayRuntime, type OsuGameplayRuntimeOptions } from "./osu/OsuGameplayRuntime";
import type { GameplayBackgroundState, GameplaySession, GameplaySessionBinding, ManiaPointerInput, OsuPointerInput } from "./GameplaySession";
import type { CompletedGameplay } from "../replay/RecordedReplay";
import { createManiaAutoplayReplay, createOsuAutoplayReplay } from "./AutoplayReplay";
import { applyOsuHitObjectStacking } from "./osu/OsuHitObjectStacking";
import type { GameplayPerformanceSample } from "./GameplayPerformance";
import type { GameplayConfiguration } from "./GameplayConfiguration";

export interface GameplaySessionOptions {
  canvas: HTMLCanvasElement;
  data: GameplayData;
  configuration: GameplayConfiguration;
  input_bindings: readonly (string | null)[];
  initial_lead_in?: number;
  autoplay?: boolean;
  playback?: CompletedGameplay;
  finish: (completed: CompletedGameplay, reached_chart_end: boolean) => void;
  background_state_change?: (state: GameplayBackgroundState) => void;
  performance_sample?: (sample: GameplayPerformanceSample) => void;
}

export interface GameplaySessionFactoryDependencies {
  create_mania(options: ManiaGameplayRuntimeOptions): GameplaySession & ManiaPointerInput;
  create_osu(options: OsuGameplayRuntimeOptions): GameplaySession & OsuPointerInput;
}

const default_dependencies: GameplaySessionFactoryDependencies = {
  create_mania: (options) => new ManiaGameplayRuntime(options),
  create_osu: (options) => new OsuGameplayRuntime(options),
};

export function createGameplaySession(options: GameplaySessionOptions,
  dependencies: GameplaySessionFactoryDependencies = default_dependencies): GameplaySessionBinding {
  if (options.playback && (options.playback.replay.mode !== options.data.mode ||
    options.playback.replay_base.mode !== options.data.mode)) {
    throw new Error("Replay mode does not match gameplay mode");
  }
  if (options.data.mode === "mania") {
    const configured = options.configuration.mania;
    const replay_base = new ManiaReplayBase();
    if (options.playback?.replay_base.mode === "mania") {
      replay_base.importReplayBase(options.playback.replay_base);
    } else {
      replay_base.importReplayBase(configured.replay_base.exportReplayBase());
      replay_base.nearest = configured.hit_registration === "nearest";
      replay_base.setTimingIdentity(new Timings("osuod", normalizeOsuOd(options.data.chart.overall_difficulty ?? 5)),
        new Subtimings("scorev", 2));
    }
    const playback_replay = options.playback?.replay.mode === "mania" ? options.playback.replay
      : options.autoplay ? createManiaAutoplayReplay(options.data.chart, replay_base.tap_only) : undefined;
    const session = dependencies.create_mania({
      canvas: options.canvas,
      data: options.data,
      configuration: { ...options.configuration.common, ...configured, replay_base,
        hit_registration: replay_base.nearest ? "nearest" : "earliest" },
      input_bindings: options.input_bindings,
      finish: options.finish,
      playback_replay,
      initial_lead_in: options.initial_lead_in,
      background_state_change: options.background_state_change,
      performance_sample: options.performance_sample,
    });
    return { mode: "mania", session, pointer_input: session };
  }
  const configured = options.configuration.osu;
  const osu_replay_base = options.playback?.replay_base.mode === "osu"
    ? options.playback.replay_base
    : {
      ...createOsuReplayBase(configured.replay_base.rate, configured.replay_base.overall_difficulty
        ?? normalizeOsuOd(options.data.chart.overall_difficulty ?? 5)),
      approach_rate: configured.replay_base.approach_rate,
      circle_size: configured.replay_base.circle_size,
      overall_difficulty: configured.replay_base.overall_difficulty,
    };
  const playback_replay = options.playback?.replay.mode === "osu" ? options.playback.replay
    : options.autoplay ? createOsuAutoplayReplay(applyOsuHitObjectStacking(options.data.chart,
      osu_replay_base.approach_rate ?? options.data.chart.approach_rate,
      osu_replay_base.circle_size ?? options.data.chart.circle_size)) : undefined;
  const session = dependencies.create_osu({
    canvas: options.canvas,
    data: options.data,
    configuration: { ...options.configuration.common, ...configured,
      cursor_renderer: playback_replay ? "webgl" : configured.cursor_renderer, replay_base: osu_replay_base },
    input_bindings: options.input_bindings,
    finish: options.finish,
    playback_replay,
    initial_lead_in: options.initial_lead_in,
    background_state_change: options.background_state_change,
    performance_sample: options.performance_sample,
  });
  return { mode: "osu", session, pointer_input: session };
}
