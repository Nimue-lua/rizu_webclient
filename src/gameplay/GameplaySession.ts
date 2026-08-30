export interface GameplaySession {
  start(): void;
  destroy(): void;
}

export type GameplayBackgroundState = "visible" | "hidden";

export interface ManiaPointerInput {
  pressPointer(pointer_id: number, column: number, performance_time: number): void;
  releasePointer(pointer_id: number, performance_time: number): void;
}

export interface OsuPointerInput {
  aimPointer(pointer_id: number, client_x: number, client_y: number,
    bounds: { left: number; top: number; width: number; height: number }, performance_time: number): void;
  pressPointer(pointer_id: number, action: "primary" | "secondary", performance_time: number): void;
  releasePointer(pointer_id: number, action: "primary" | "secondary", performance_time: number): void;
  cancelPointer(pointer_id: number, performance_time: number): void;
}

export type GameplaySessionBinding =
  | { mode: "mania"; session: GameplaySession; pointer_input: ManiaPointerInput }
  | { mode: "osu"; session: GameplaySession; pointer_input: OsuPointerInput };
