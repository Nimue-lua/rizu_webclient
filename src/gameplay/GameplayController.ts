import type { GameplayData, GameplayLoadProgress, GameplayLocation } from "../library/GameplayLoader";
import type { Chartview } from "../library/views";
import type { CompletedGameplay } from "../replay/RecordedReplay";
import type { GameplayConfiguration } from "./GameplayConfiguration";
import type { GameplayBackgroundState } from "./GameplaySession";

export interface PlayRequest {
  chart: Chartview;
  input_bindings: readonly (string | null)[];
  song: { title: string; artist: string };
}

export type GameplayLaunch =
  | { kind: "play"; request: PlayRequest }
  | { kind: "autoplay"; request: PlayRequest }
  | { kind: "replay"; request: PlayRequest; playback: CompletedGameplay }
  | { kind: "note-skin-editor"; request: PlayRequest };

export type GameplayPreparationStatus = "idle" | "setup" | "preparing" | "ready" | "running" | "completed";
export type GameplayFinishOutcome = "result" | "discarded" | "replay";

export interface GameplayController {
  readonly status: GameplayPreparationStatus;
  readonly location: GameplayLocation | null;
  readonly audio_context: AudioContext | null;
  readonly assets: GameplayData | null;
  readonly configuration: GameplayConfiguration;
  readonly input_bindings: readonly (string | null)[];
  readonly playback: CompletedGameplay | null;
  readonly autoplay: boolean;
  readonly note_skin_editor: boolean;
  readonly background_url: string | null;
  readonly background_state: GameplayBackgroundState;
  readonly loading_progress: ReadonlyMap<string, GameplayLoadProgress>;
  readonly loading_error: string | null;
  begin(launch: GameplayLaunch): void;
  preload_audio(): Promise<void>;
  set_input_bindings(bindings: readonly (string | null)[]): void;
  select_note_skin(skin_id: string): void;
  prepare(): Promise<void>;
  start(): void;
  cancel(): void;
  finish(completed: CompletedGameplay, reached_chart_end: boolean): GameplayFinishOutcome;
  replay(): void;
  discard(): void;
  set_background_state(state: GameplayBackgroundState): void;
}
