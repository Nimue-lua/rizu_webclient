import type { OsuStandardSkin } from "../../../noteskin/osu/OsuSkin";
import { drawBitmapText } from "../../renderer/BitmapTextRenderer";
import type { SpriteQuadWriter } from "../../renderer/Sprite";
import type { OsuSpinnerPresentationState } from "../OsuSliderPresentation";
import type { OsuViewport } from "../OsuViewport";

export function drawSpinner(skin: OsuStandardSkin, viewport: OsuViewport,
  state: OsuSpinnerPresentationState, write: SpriteQuadWriter): void {
  const center = viewport.playfieldToScreen({ x: 256, y: 192 });
  const addCentered = (sprite: OsuStandardSkin["spinnerCircle"], rotation = 0, scale = 1) => {
    if (!sprite) return;
    const width = sprite.sourceSize.w * viewport.scale * scale;
    const height = sprite.sourceSize.h * viewport.scale * scale;
    write(center.x - width / 2, center.y - height / 2, width, height, [1, 1, 1, state.opacity], sprite,
      false, undefined, false, rotation);
  };
  const legacy = skin.spinnerCircle !== undefined;
  if (legacy) {
    addCentered(skin.spinnerBackground);
    addCentered(skin.spinnerCircle, state.rotation_radians);
    addCentered(skin.spinnerMetre);
  } else {
    const layers = [skin.spinnerBottom, skin.spinnerMiddle, skin.spinnerTop].filter(Boolean);
    const layered_scale = layers.length === 0 ? 1 : Math.min(1,
      512 / Math.max(...layers.map((sprite) => sprite!.sourceSize.w)),
      384 / Math.max(...layers.map((sprite) => sprite!.sourceSize.h)));
    addCentered(skin.spinnerBottom, 0, layered_scale);
    addCentered(skin.spinnerMiddle, 0, layered_scale);
    addCentered(skin.spinnerTop, state.rotation_radians, layered_scale);
  }
  addCentered(skin.spinnerApproachCircle, 0, 1.86 - 1.76 * state.duration_progress);

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
