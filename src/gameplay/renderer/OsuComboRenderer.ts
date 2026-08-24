import { drawBitmapText } from "./BitmapTextRenderer";
import type { Sprite, SpriteQuadWriter } from "./Sprite";

export interface OsuComboAssets {
  readonly sprites: Readonly<Record<string, Sprite>>;
  readonly comboGlyphs: Readonly<Record<string, string>>;
  readonly comboOverlap: number;
}

export class OsuComboRenderer {
  constructor(private readonly assets: OsuComboAssets) {}

  draw(combo: number, left: number, bottom: number, write: SpriteQuadWriter): void {
    if (combo <= 0) return;
    const height = this.assets.sprites[this.assets.comboGlyphs["0"] ?? ""]?.sourceSize.h ?? 0;
    drawBitmapText(this.assets.sprites, String(combo), this.assets.comboGlyphs, this.assets.comboOverlap,
      left, bottom - height * 0.625, 1, "left", write);
  }
}
