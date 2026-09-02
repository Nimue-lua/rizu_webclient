import type { GameplayHudRenderer, HudLayout } from "../GameplayHudRenderer";
import type { HitErrorMeterState, HudState } from "../HudState";
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
  readonly hitErrorFill?: Sprite;
  readonly hitErrorArrow?: Sprite;
}

export interface HitErrorMeterOptions {
  readonly enabled: boolean;
  readonly type: HitErrorMeterType;
  readonly scale: number;
}

export type HitErrorMeterType = "normal" | "fullscreen";

export class SpriteGameplayHudRenderer implements GameplayHudRenderer {
  constructor(private readonly assets: HudAssets, private readonly write: SpriteQuadWriter,
    private readonly hit_error_options: HitErrorMeterOptions = { enabled: true, type: "normal", scale: 1 }) {}

  drawScore(hud: HudState, layout: HudLayout): void {
    if (!this.assets.scoreGlyphs) return;
    const score = String(Math.max(0, Math.ceil(hud.score))).padStart(7, "0");
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

  drawHitErrorMeter(state: HitErrorMeterState, layout: HudLayout): void {
    if (!this.hit_error_options.enabled) return;
    const fill = this.assets.hitErrorFill;
    const windows = state.windows;
    if (!fill || !windows || state.age >= 4.6) return;
    const alpha = state.age <= 4 ? 1 : 1 - (state.age - 4) / 0.6;
    const range = windows[2];
    if (!(range > 0)) return;
    const center_x = layout.width / 2;
    if (this.hit_error_options.type === "normal") {
      this.drawNormalHitErrorMeter(state, layout, fill, windows, alpha, range, center_x);
      return;
    }
    const width = layout.width;
    for (const tick of state.ticks) {
      if (tick.age >= 0.300) continue;
      const error = Math.abs(tick.deltaTime);
      const center_fade = error / 0.024;
      const opacity = error <= 0.024 ? center_fade * center_fade * 0.6 : error < windows[0] ? 0.08 : 0.6;
      const tick_alpha = opacity * Math.max(0, 1 - tick.age / 0.300) * alpha;
      const color = tick.deltaTime < 0
        ? [87 / 255, 227 / 255, 19 / 255] as const
        : [255 / 255, 0, 0] as const;
      const normalized_error = tick.deltaTime / range;
      const position = Math.sign(normalized_error) * Math.sqrt(Math.abs(normalized_error));
      this.write(center_x + position * width / 2 - 2.5, 0,
        5, layout.height, [color[0], color[1], color[2], tick_alpha], fill,
        false, undefined, false, 0, undefined, true);
    }
  }

  private drawNormalHitErrorMeter(state: HitErrorMeterState, layout: HudLayout, fill: Sprite,
    windows: readonly [number, number, number], alpha: number, range: number, center_x: number): void {
    const scale = this.hit_error_options.scale;
    const center_y = layout.height - 6 * scale;
    const width = range * 1000 * 1.6 * scale;
    const bar_height = 4.8 * scale;
    const color300 = [50 / 255, 188 / 255, 231 / 255, alpha] as const;
    const color100 = [87 / 255, 227 / 255, 19 / 255, alpha] as const;
    const color50 = [218 / 255, 174 / 255, 70 / 255, alpha] as const;
    const draw_centered = (draw_width: number, draw_height: number,
      color: readonly [number, number, number, number]) => {
      this.write(center_x - draw_width / 2, center_y - draw_height / 2, draw_width, draw_height, color, fill);
    };
    draw_centered(width * 1.6, bar_height * 4 * 1.6, [0, 0, 0, 0.6 * alpha]);
    draw_centered(width, bar_height, color50);
    draw_centered(windows[1] / range * width, bar_height, color100);
    draw_centered(windows[0] / range * width, bar_height, color300);
    draw_centered(2.4 * scale, bar_height * 4, [1, 1, 1, alpha]);
    for (const tick of state.ticks) {
      const tick_alpha = 0.4 * Math.max(0, 1 - tick.age / 10) * alpha;
      const error = Math.abs(tick.deltaTime);
      const color = error < windows[0] ? color300 : error < windows[1] ? color100 : color50;
      this.write(center_x + tick.deltaTime / range * width / 2 - 1.5 * scale, center_y - bar_height * 2,
        3 * scale, bar_height * 4, [color[0], color[1], color[2], tick_alpha], fill,
        false, undefined, false, 0, undefined, true);
    }
    const arrow = this.assets.hitErrorArrow;
    if (!arrow) return;
    const arrow_width = arrow.sourceSize.w * 0.6 * scale;
    const arrow_height = arrow.sourceSize.h * 0.6 * scale;
    const arrow_x = center_x + state.floatingError / range * width / 2;
    this.write(arrow_x - arrow_width / 2, center_y - 3 - arrow_height,
      arrow_width, arrow_height, [1, 1, 1, alpha], arrow);
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
