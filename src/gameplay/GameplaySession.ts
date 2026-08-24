export interface GameplaySession {
  start(): void;
  destroy(): void;
}

export interface ManiaPointerInput {
  pressPointer(pointer_id: number, column: number, performance_time: number): void;
  releasePointer(pointer_id: number, performance_time: number): void;
}

export type GameplaySessionBinding =
  | { mode: "mania"; session: GameplaySession; pointer_input: ManiaPointerInput }
  | { mode: "osu"; session: GameplaySession };
