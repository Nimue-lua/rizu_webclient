import type { HudState } from "./HudState";

export interface HudLayout {
  readonly scoreRight: number;
  readonly scoreTop: number;
}

export interface GameplayHudRenderer {
  draw(state: HudState, layout: HudLayout): void;
}

export function getGameplayHudLayout(logical_width: number): HudLayout {
  return { scoreRight: logical_width - 6, scoreTop: 0 };
}
