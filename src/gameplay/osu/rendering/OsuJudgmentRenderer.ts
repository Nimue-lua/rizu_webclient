import type { OsuChart } from "../../../chart/Chart";
import type { OsuStandardSkin } from "../../../noteskin/osu/OsuSkin";
import type { SpriteQuadWriter } from "../../renderer/Sprite";
import type { OsuCircleTransient } from "../OsuCirclePresentation";
import type { OsuViewport } from "../OsuViewport";
import { comboColor, HIT_FADE_OUT, MISS_FADE_OUT, OSU_HIT_OBJECT_TEXTURE_SIZE } from "./OsuPlayfieldRenderShared";

const JUDGMENT_FADE_IN = 0.12;
const JUDGMENT_HOLD = 0.5;
export const JUDGMENT_LIFETIME = 1.1;

export function drawCircleTransients(skin: OsuStandardSkin, viewport: OsuViewport, chart: OsuChart,
  circle_transients: readonly OsuCircleTransient[], song_time: number, diameter: number,
  write: SpriteQuadWriter): void {
  for (const transient of circle_transients) {
    if (transient.kind === "shake") continue;
    const age = song_time - transient.start_time;
    if (age < 0 || age >= JUDGMENT_LIFETIME) continue;
    const object = chart.hit_objects[transient.object_index];
    if (!object) continue;
    const center = viewport.playfieldToScreen(transient.position ?? object);
    const combo = comboColor(skin, chart, object.combo_color_index ?? 0);
    if (object.kind === "circle" && transient.kind === "hit" && age < HIT_FADE_OUT) {
      const progress = age / HIT_FADE_OUT;
      const scale = 1 + 0.4 * (2 * progress - progress * progress);
      const alpha = 1 - progress;
      const size = diameter * scale;
      write(center.x - size / 2, center.y - size / 2, size, size,
        [combo[0], combo[1], combo[2], alpha], skin.hitCircle);
      write(center.x - size / 2, center.y - size / 2, size, size, [1, 1, 1, alpha], skin.hitCircleOverlay);
    } else if (object.kind === "circle" && transient.kind === "miss" && age < MISS_FADE_OUT) {
      const alpha = 1 - age / MISS_FADE_OUT;
      write(center.x - diameter / 2, center.y - diameter / 2, diameter, diameter,
        [combo[0], combo[1], combo[2], alpha], skin.hitCircle);
      write(center.x - diameter / 2, center.y - diameter / 2, diameter, diameter,
        [1, 1, 1, alpha], skin.hitCircleOverlay);
    }
    drawJudgment(skin, viewport, center, transient.kind === "hit" ? transient.judgment : "miss", age,
      diameter / OSU_HIT_OBJECT_TEXTURE_SIZE, write);
  }
}

function drawJudgment(skin: OsuStandardSkin, viewport: OsuViewport, center: { x: number; y: number },
  judgment: string, age: number, gamefield_scale: number, write: SpriteQuadWriter): void {
  const frames = skin.judgments[judgment] ?? [];
  const frame_name = frames[Math.min(frames.length - 1, Math.floor(age * 60))];
  const sprite = frame_name && skin.sprites[frame_name];
  if (!sprite) return;
  let alpha = age < JUDGMENT_FADE_IN ? age / JUDGMENT_FADE_IN
    : age < JUDGMENT_HOLD ? 1 : (JUDGMENT_LIFETIME - age) / (JUDGMENT_LIFETIME - JUDGMENT_HOLD);
  let scale = 1;
  let y = center.y;
  if (judgment === "miss" && frames.length === 1) {
    scale = age < JUDGMENT_FADE_IN ? 2 - age / JUDGMENT_FADE_IN : 1;
    const progress = age / JUDGMENT_LIFETIME;
    y += (-5 + 45 * progress * progress) * viewport.scale;
  }
  alpha = Math.max(0, Math.min(1, alpha));
  const width = sprite.sourceSize.w * gamefield_scale * scale;
  const height = sprite.sourceSize.h * gamefield_scale * scale;
  write(center.x - width / 2, y - height / 2, width, height, [1, 1, 1, alpha], sprite);
}
