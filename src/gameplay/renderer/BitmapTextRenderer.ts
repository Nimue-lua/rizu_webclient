import type { Sprite, SpriteQuadWriter } from "./Sprite";

export function drawBitmapText(sprites: Readonly<Record<string, Sprite>>, text: string,
  glyphs: Readonly<Record<string, string>>, overlap: number, anchor_x: number, y: number, scale: number,
  align: "left" | "center" | "right", write: SpriteQuadWriter): void {
  const constant_width = sprites[glyphs["5"] ?? ""]?.sourceSize.w ?? 40;
  const placements: { sprite: Sprite; x: number }[] = [];
  let x = 0;
  for (const character of text) {
    const sprite = sprites[glyphs[character] ?? ""];
    if (!sprite) continue;
    const standard = character >= "0" && character <= "9";
    placements.push({ sprite, x: x + (standard ? Math.max(0, (constant_width - sprite.sourceSize.w) * 0.5) : 0) });
    x += (standard ? constant_width : sprite.sourceSize.w) - overlap;
  }
  const logical_scale = 0.625 * scale;
  const alignment = align === "center" ? 0.5 : align === "right" ? 1 : 0;
  const left = anchor_x - x * logical_scale * alignment;
  for (const placement of placements) {
    write(left + placement.x * logical_scale, y, placement.sprite.sourceSize.w * logical_scale,
      placement.sprite.sourceSize.h * logical_scale, [1, 1, 1, 1], placement.sprite);
  }
}
