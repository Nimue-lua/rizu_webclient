import assert from "node:assert/strict";
import test from "node:test";
import { ManiaOverlayRenderer } from "../src/gameplay/renderer/ManiaOverlayRenderer";
import { OsuComboRenderer } from "../src/gameplay/renderer/OsuComboRenderer";
import type { Sprite } from "../src/gameplay/renderer/Sprite";

function sprite(name: string, width = 20, height = 30): Sprite & { name: string } {
  return { name, image: {} as ImageBitmap, sourceSize: { w: width, h: height }, pixelSize: { w: width, h: height } };
}

test("mania overlay centers judgments and combo inside its lanes", () => {
  const sprites = { judge: sprite("judge", 100, 40), digit: sprite("digit") };
  const overlay = new ManiaOverlayRenderer({ sprites, judgments: { perfect: ["judge"] },
    comboGlyphs: Object.fromEntries([..."0123456789"].map((digit) => [digit, "digit"])), comboOverlap: 0 });
  const quads: unknown[][] = [];
  overlay.draw({ centerX: 152, comboTop: 100, judgmentCenterY: 125 },
    { hud: { score: 0, accuracy: 98.5 }, combo: 12, judgment: "perfect", judgmentAge: 0 },
    (...quad) => quads.push(quad));
  assert.deepEqual(quads[0]?.slice(0, 4), [120.75, 112.5, 62.5, 25]);
  assert.deepEqual(quads[1]?.slice(0, 4), [139.5, 100, 12.5, 18.75]);
});

test("osu combo uses a lower-left anchored layout without a global judgment", () => {
  const digit = sprite("digit");
  const combo = new OsuComboRenderer({ sprites: { digit },
    comboGlyphs: Object.fromEntries([..."0123456789"].map((value) => [value, "digit"])), comboOverlap: 0 });
  const quads: unknown[][] = [];
  combo.draw(12, 8, 472, (...quad) => quads.push(quad));
  assert.deepEqual(quads[0]?.slice(0, 4), [8, 453.25, 12.5, 18.75]);
});
