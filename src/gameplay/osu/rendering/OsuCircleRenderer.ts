import type { OsuStandardSkin } from "../../../noteskin/osu/OsuSkin";
import type { SpriteQuadWriter } from "../../renderer/Sprite";
import type { OsuViewport, Point } from "../OsuViewport";
import { OSU_HIT_OBJECT_TEXTURE_SIZE, type OsuColor } from "./OsuPlayfieldRenderShared";

export function drawCircle(skin: OsuStandardSkin, viewport: OsuViewport, position: Point, diameter: number,
  alpha: number, approach_alpha: number, approach_scale: number, combo: OsuColor, combo_number: number | null,
  write: SpriteQuadWriter, circle_scale = 1, number_alpha = alpha): void {
  const center = viewport.playfieldToScreen(position);
  const size = diameter * circle_scale;
  write(center.x - size / 2, center.y - size / 2, size, size,
    [combo[0], combo[1], combo[2], alpha], skin.hitCircle);
  if (combo_number !== null && number_alpha > 0) drawComboNumber(skin, center, combo_number, diameter, number_alpha, write);
  write(center.x - size / 2, center.y - size / 2, size, size, [1, 1, 1, alpha], skin.hitCircleOverlay);
  const approach_size = diameter * approach_scale;
  write(center.x - approach_size / 2, center.y - approach_size / 2, approach_size, approach_size,
    [combo[0], combo[1], combo[2], approach_alpha], skin.approachCircle);
}

function drawComboNumber(skin: OsuStandardSkin, center: Point, combo_number: number, diameter: number,
  alpha: number, write: SpriteQuadWriter): void {
  const digits = String(combo_number).split("").map((digit) => skin.hitCircleGlyphs?.[digit]).filter(Boolean);
  if (digits.length === 0) return;
  const scale = diameter / OSU_HIT_OBJECT_TEXTURE_SIZE * 0.8;
  const overlap = skin.hitCircleOverlap ?? -2;
  const width = digits.reduce((total, digit, index) =>
    total + digit!.sourceSize.w - (index > 0 ? overlap : 0), 0) * scale;
  const height = digits[0]!.sourceSize.h * scale;
  let x = center.x - width / 2;
  for (const [index, digit] of digits.entries()) {
    if (index > 0) x -= overlap * scale;
    const digit_width = digit!.sourceSize.w * scale;
    write(x, center.y - height / 2, digit_width, digit!.sourceSize.h * scale, [1, 1, 1, alpha], digit!);
    x += digit_width;
  }
}

export function stableShakeOffset(age: number): number {
  const milliseconds = age * 1000;
  if (milliseconds < 0 || milliseconds >= 120) return 0;
  if (milliseconds < 20) return interpolate(0, 8, milliseconds / 20);
  if (milliseconds < 40) return interpolate(8, -8, (milliseconds - 20) / 20);
  if (milliseconds < 60) return interpolate(-8, 8, (milliseconds - 40) / 20);
  if (milliseconds < 80) return interpolate(8, -8, (milliseconds - 60) / 20);
  if (milliseconds < 100) return interpolate(8, -8, (milliseconds - 80) / 20);
  return interpolate(8, 0, (milliseconds - 100) / 20);
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}
