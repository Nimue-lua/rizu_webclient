import type { GameplayHudRenderer, HudLayout } from "../GameplayHudRenderer";
import type { HudState } from "../HudState";
import { drawBitmapText } from "./BitmapTextRenderer";
import type { Sprite, SpriteQuadWriter } from "./Sprite";

const OSU_NATIVE_SCALE = 0.625;

export interface HudAssets {
  readonly sprites: Readonly<Record<string, Sprite>>;
  readonly hpBackground?: Sprite;
  readonly hpFill?: Sprite;
  readonly scoreGlyphs?: Readonly<Record<string, string>>;
  readonly scoreOverlap?: number;
}

export class SpriteGameplayHudRenderer implements GameplayHudRenderer {
  constructor(private readonly assets: HudAssets, private readonly write: SpriteQuadWriter) {}

  drawScore(hud: HudState, layout: HudLayout): void {
    if (!this.assets.scoreGlyphs) return;
    const score = String(Math.max(0, Math.round(hud.score))).padStart(7, "0");
    drawBitmapText(this.assets.sprites, score, this.assets.scoreGlyphs, this.assets.scoreOverlap ?? 0,
      layout.scoreRight, layout.scoreTop, 0.96, "right", this.write);
    const score_height = this.bitmapTextHeight(this.assets.scoreGlyphs) * 0.625 * 0.96;
    drawBitmapText(this.assets.sprites, `${hud.accuracy.toFixed(2).padStart(5, "0")}%`, this.assets.scoreGlyphs,
      this.assets.scoreOverlap ?? 0, layout.scoreRight, layout.scoreTop + score_height + 3, 0.576, "right", this.write);
  }

  drawHpBar(): void {
    const background = this.assets.hpBackground;
    const fill = this.assets.hpFill;
    if (background) this.write(0, 0, background.sourceSize.w * OSU_NATIVE_SCALE,
      background.sourceSize.h * OSU_NATIVE_SCALE,
      [1, 1, 1, 1], background);
    if (fill) this.write(7.5, 7.8, fill.sourceSize.w * OSU_NATIVE_SCALE,
      fill.sourceSize.h * OSU_NATIVE_SCALE,
      [1, 1, 1, 1], fill);
  }

  private bitmapTextHeight(glyphs: Readonly<Record<string, string>>): number {
    return this.assets.sprites[glyphs["0"] ?? ""]?.sourceSize.h ?? 0;
  }
}
