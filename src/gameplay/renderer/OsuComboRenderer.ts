import { drawBitmapText } from "./BitmapTextRenderer";
import type { Sprite, SpriteQuadWriter } from "./Sprite";

export interface OsuComboAssets {
  readonly sprites: Readonly<Record<string, Sprite>>;
  readonly comboGlyphs: Readonly<Record<string, string>>;
  readonly comboOverlap: number;
}

export class OsuComboRenderer {
  constructor(private readonly assets: OsuComboAssets) {}

  draw(combo: number, animation_age: number, animation_from: number,
    left: number, bottom: number, write: SpriteQuadWriter): void {
    if (combo <= 0) return;
    const height = this.assets.sprites[this.assets.comboGlyphs["0"] ?? ""]?.sourceSize.h ?? 0;
    const animating = animation_age >= 0 && animation_age < 0.3;
    const handoff_age = animation_age - 0.16;
    const main_combo = animating && handoff_age < 0 ? animation_from : combo;
    let main_scale = 1;
    if (animating && handoff_age >= 0 && handoff_age < 0.05) {
      const progress = handoff_age / 0.05;
      main_scale = 1 + 0.09375 * progress * progress;
    } else if (animating && handoff_age < 0.1 && handoff_age >= 0.05) {
      const progress = (handoff_age - 0.05) / 0.05;
      main_scale = 1.09375 - 0.09375 * (2 * progress - progress * progress);
    }
    if (main_combo > 0) this.drawText(main_combo, left, bottom, height, main_scale, 1, write);
    if (animating) {
      const progress = animation_age / 0.3;
      const flash_scale = 1.5625 - 0.5625 * progress;
      this.drawText(combo, left, bottom, height, flash_scale, 0.6 * (1 - progress), write);
    }
  }

  private drawText(combo: number, left: number, bottom: number, height: number, scale: number, alpha: number,
    write: SpriteQuadWriter): void {
    drawBitmapText(this.assets.sprites, `${combo}x`, this.assets.comboGlyphs, this.assets.comboOverlap,
      left, bottom - height * 0.625 * scale, scale, "left", write, alpha);
  }
}
