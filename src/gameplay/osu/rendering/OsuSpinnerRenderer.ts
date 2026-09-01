import type { OsuStandardSkin } from "../../../noteskin/osu/OsuSkin";
import { drawBitmapText } from "../../renderer/BitmapTextRenderer";
import type { SpriteQuadWriter } from "../../renderer/Sprite";
import type { OsuSpinnerPresentationState } from "../OsuSliderPresentation";
import type { OsuViewport } from "../OsuViewport";
import type { Sprite } from "../../renderer/Sprite";

export function drawSpinner(skin: OsuStandardSkin, viewport: OsuViewport,
  state: OsuSpinnerPresentationState, write: SpriteQuadWriter): void {
  const center = viewport.playfieldToScreen({ x: 256, y: 192 });
  const legacy = skin.spinnerCircle !== undefined;
  if (legacy) {
    drawCentered(skin.spinnerBackground, center.x, center.y, viewport.scale, state.opacity, write);
    drawCentered(skin.spinnerCircle, center.x, center.y, viewport.scale, state.opacity, write, state.rotation_radians);
    drawCentered(skin.spinnerMetre, center.x, center.y, viewport.scale, state.opacity, write);
  } else {
    const layered_scale = spinnerLayerScale(skin.spinnerBottom, skin.spinnerMiddle, skin.spinnerTop);
    drawCentered(skin.spinnerBottom, center.x, center.y, viewport.scale * layered_scale, state.opacity, write);
    drawCentered(skin.spinnerMiddle, center.x, center.y, viewport.scale * layered_scale, state.opacity, write);
    drawCentered(skin.spinnerTop, center.x, center.y, viewport.scale * layered_scale, state.opacity, write,
      state.rotation_radians);
  }
  drawCentered(skin.spinnerApproachCircle, center.x, center.y,
    viewport.scale * (1.86 - 1.76 * state.duration_progress), state.opacity, write);

  const rpm_background = skin.spinnerRpm;
  const eased_fade_in = 1 - (1 - state.fade_in_progress) * (1 - state.fade_in_progress);
  const y = viewport.stage_top + (447 - 50 * eased_fade_in) * viewport.scale;
  if (rpm_background) {
    const width = rpm_background.sourceSize.w * viewport.scale;
    const height = rpm_background.sourceSize.h * viewport.scale;
    const x = center.x - width / 2;
    write(x, y, width, height, [1, 1, 1, state.opacity], rpm_background);
  }
  drawBitmapText(skin.sprites, String(Math.round(state.rpm)), skin.scoreGlyphs, skin.scoreOverlap,
    center.x + 80 * viewport.scale, y + 3 * viewport.scale, 0.9 * viewport.scale, "right", write, state.opacity);
}

function drawCentered(sprite: Sprite | undefined, center_x: number, center_y: number, scale: number,
  opacity: number, write: SpriteQuadWriter, rotation = 0): void {
  if (!sprite) return;
  const width = sprite.sourceSize.w * scale;
  const height = sprite.sourceSize.h * scale;
  write(center_x - width / 2, center_y - height / 2, width, height, [1, 1, 1, opacity], sprite,
    false, undefined, false, rotation);
}

function spinnerLayerScale(bottom: Sprite | undefined, middle: Sprite | undefined, top: Sprite | undefined): number {
  let max_width = 0;
  let max_height = 0;
  if (bottom) { max_width = bottom.sourceSize.w; max_height = bottom.sourceSize.h; }
  if (middle) { max_width = Math.max(max_width, middle.sourceSize.w); max_height = Math.max(max_height, middle.sourceSize.h); }
  if (top) { max_width = Math.max(max_width, top.sourceSize.w); max_height = Math.max(max_height, top.sourceSize.h); }
  return max_width === 0 || max_height === 0 ? 1 : Math.min(1, 512 / max_width, 384 / max_height);
}
