import type { GameplayData, ManiaGameplayData, OsuGameplayData } from "../library/GameplayLoader";
import { createOsuReplayBase, ReplayBase, type OsuReplayBaseValues } from "../replay/ReplayBase";
import { Subtimings } from "./timing/Subtimings";
import { Timings } from "./timing/Timings";
import { normalizeOsuOd } from "./timing/OsuManiaV2Timings";
import type { ManiaHitRegistration } from "./ManiaRulesEngine";
import { ManiaGameplayRuntime } from "./ManiaGameplayRuntime";
import { OsuGameplayRuntime } from "./OsuGameplayRuntime";
import type { GameplaySession, GameplaySessionBinding, ManiaPointerInput } from "./GameplaySession";
import type { ScoreResult } from "./scoring/ScoreResult";

export interface GameplaySessionOptions {
  canvas: HTMLCanvasElement;
  data: GameplayData;
  master_volume: number;
  music_offset: number;
  scroll_speed: number;
  replay_base: ReplayBase;
  input_bindings: readonly (string | null)[];
  hit_registration: ManiaHitRegistration;
  finish: (score: ScoreResult) => void;
}

export interface GameplaySessionFactoryDependencies {
  create_mania(options: GameplaySessionOptions & { data: ManiaGameplayData; replay_base: ReplayBase }): GameplaySession & ManiaPointerInput;
  create_osu(options: Omit<GameplaySessionOptions, "replay_base"> &
    { data: OsuGameplayData; replay_base: OsuReplayBaseValues }): GameplaySession;
}

const default_dependencies: GameplaySessionFactoryDependencies = {
  create_mania: (options) => new ManiaGameplayRuntime(options.canvas, options.data, options.master_volume,
    options.music_offset, options.scroll_speed, options.replay_base, options.input_bindings,
    options.hit_registration, options.finish),
  create_osu: (options) => new OsuGameplayRuntime(options.canvas, options.data, options.master_volume,
    options.music_offset, options.replay_base, options.finish),
};

export function createGameplaySession(options: GameplaySessionOptions,
  dependencies: GameplaySessionFactoryDependencies = default_dependencies): GameplaySessionBinding {
  if (options.data.mode === "mania") {
    const replay_base = new ReplayBase();
    replay_base.importReplayBase(options.replay_base.exportReplayBase());
    replay_base.nearest = options.hit_registration === "nearest";
    replay_base.setTimingIdentity(new Timings("osuod", normalizeOsuOd(options.data.chart.overall_difficulty ?? 5)),
      new Subtimings("scorev", 2));
    const session = dependencies.create_mania({ ...options, data: options.data, replay_base });
    return { mode: "mania", session, pointer_input: session };
  }
  const { replay_base, ...common_options } = options;
  return { mode: "osu", session: dependencies.create_osu({
    ...common_options,
    data: options.data,
    replay_base: createOsuReplayBase(replay_base.rate,
      normalizeOsuOd(options.data.chart.overall_difficulty ?? 5)),
  }) };
}
