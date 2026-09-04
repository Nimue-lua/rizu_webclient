import { useEffect, useSyncExternalStore } from "react";
import type { GameController } from "../GameController";
import type { GameState } from "../GameState";

export function useRizuAppController(game: GameController): GameState {
  useEffect(() => {
    game.load();
    return () => game.unload();
  }, [game]);
  return useSyncExternalStore(game.subscribe, game.getSnapshot, game.getSnapshot);
}
