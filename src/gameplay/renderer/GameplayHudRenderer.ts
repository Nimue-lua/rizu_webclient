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
  readonly progressOverlay?: Sprite;
  readonly progressFill?: Sprite;
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

  drawProgress(progress: number | null, layout: HudLayout): void {
    const overlay = this.assets.progressOverlay;
    const fill = this.assets.progressFill;
    if (progress === null || !overlay || !fill) return;
    const score_height = this.assets.scoreGlyphs ? this.bitmapTextHeight(this.assets.scoreGlyphs) * OSU_NATIVE_SCALE * 0.96 : 0;
    const accuracy_height = score_height * 0.6;
    const center_x = layout.scoreRight - this.accuracyWidth() - 24;
    const center_y = layout.scoreTop + score_height + 3 + accuracy_height / 2;
    this.write(center_x - 10, center_y - 10, 20, 20,
      progress < 0 ? [199 / 255, 1, 47 / 255, 0.6] : [1, 1, 1, 0.6], fill,
      false, undefined, false, 0, progress);
    const width = overlay.sourceSize.w * OSU_NATIVE_SCALE;
    const height = overlay.sourceSize.h * OSU_NATIVE_SCALE;
    this.write(center_x - width / 2, center_y - height / 2, width, height, [1, 1, 1, 1], overlay);
  }

  private bitmapTextHeight(glyphs: Readonly<Record<string, string>>): number {
    return this.assets.sprites[glyphs["0"] ?? ""]?.sourceSize.h ?? 0;
  }

  private accuracyWidth(): number {
    if (!this.assets.scoreGlyphs) return 0;
    const glyphs = this.assets.scoreGlyphs;
    const overlap = this.assets.scoreOverlap ?? 0;
    const text = "00.00%";
    const native_width = [...text].reduce((width, character, index) => {
      const sprite = this.assets.sprites[glyphs[character] ?? ""];
      return width + (sprite?.sourceSize.w ?? 0) + (index === text.length - 1 ? 0 : overlap);
    }, 0);
    return native_width * OSU_NATIVE_SCALE * 0.576;
  }
}
