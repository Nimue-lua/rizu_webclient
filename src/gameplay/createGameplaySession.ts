import type { GameplayData, ManiaGameplayData, OsuGameplayData } from "../library/GameplayLoader";
import type { ReplayBase } from "../replay/ReplayBase";
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
  create_mania(options: GameplaySessionOptions & { data: ManiaGameplayData }): GameplaySession & ManiaPointerInput;
  create_osu(options: GameplaySessionOptions & { data: OsuGameplayData }): GameplaySession;
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
    const session = dependencies.create_mania({ ...options, data: options.data });
    return { mode: "mania", session, pointer_input: session };
  }
  return { mode: "osu", session: dependencies.create_osu({ ...options, data: options.data }) };
}
