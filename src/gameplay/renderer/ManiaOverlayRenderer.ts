import type { GameplayPresentationState } from "../HudState";
import { drawBitmapText } from "./BitmapTextRenderer";
import type { Sprite, SpriteQuadWriter } from "./Sprite";

export interface ManiaOverlayAssets {
  readonly sprites: Readonly<Record<string, Sprite>>;
  readonly judgments: Readonly<Record<string, readonly string[]>>;
  readonly comboGlyphs: Readonly<Record<string, string>>;
  readonly comboOverlap: number;
}

export interface ManiaOverlayLayout {
  readonly centerX: number;
  readonly comboTop: number;
  readonly judgmentCenterY: number;
}

export class ManiaOverlayRenderer {
  constructor(private readonly assets: ManiaOverlayAssets) {}

  draw(layout: ManiaOverlayLayout, state: GameplayPresentationState, write: SpriteQuadWriter): void {
    if (state.judgment && state.judgmentAge < 0.22) {
      const frames = this.assets.judgments[state.judgment] ?? [];
      const name = frames[Math.min(frames.length - 1, Math.floor(state.judgmentAge * 20))];
      const sprite = name ? this.assets.sprites[name] : undefined;
      if (sprite) {
        const scale = 0.625;
        const width = sprite.sourceSize.w * scale;
        const height = sprite.sourceSize.h * scale;
        const alpha = state.judgmentAge <= 0.18 ? 1 : (0.22 - state.judgmentAge) / 0.04;
        write(layout.centerX - width * 0.5, layout.judgmentCenterY - height * 0.5,
          width, height, [1, 1, 1, alpha], sprite);
      }
    }
    if (state.combo > 0) drawBitmapText(this.assets.sprites, String(state.combo), this.assets.comboGlyphs,
      this.assets.comboOverlap, layout.centerX, layout.comboTop, 1, "center", write);
  }
}
