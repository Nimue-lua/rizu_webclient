import type { HitErrorMeterState, HudState } from "./HudState";

export interface HudLayout {
  readonly scoreRight: number;
  readonly scoreTop: number;
  readonly width: number;
  readonly height: number;
}

export interface GameplayHudRenderer {
  drawHpBar(): void;
  drawScore(state: HudState, layout: HudLayout): void;
  drawProgress(progress: number | null, layout: HudLayout): void;
  drawHitErrorMeter(state: HitErrorMeterState, layout: HudLayout): void;
}

export function getGameplayHudLayout(logical_width: number): HudLayout {
  return { scoreRight: logical_width - 6, scoreTop: 0, width: logical_width, height: 480 };
}
