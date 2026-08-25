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
    { hud: { score: 0, accuracy: 98.5 }, combo: 12, comboAnimationAge: Infinity, comboAnimationFrom: 0,
      judgment: "perfect", judgmentAge: 0 },
    (...quad) => quads.push(quad));
  assert.deepEqual(quads[0]?.slice(0, 4), [120.75, 112.5, 62.5, 25]);
  assert.deepEqual(quads[1]?.slice(0, 4), [139.5, 100, 12.5, 18.75]);
});

test("osu combo uses a lower-left anchored layout without a global judgment", () => {
  const digit = sprite("digit");
  const x = sprite("x", 10, 30);
  const combo = new OsuComboRenderer({ sprites: { digit, x },
    comboGlyphs: { ...Object.fromEntries([..."0123456789"].map((value) => [value, "digit"])), x: "x" },
    comboOverlap: 0 });
  const quads: unknown[][] = [];
  combo.draw(12, Infinity, 0, 8, 472, (...quad) => quads.push(quad));
  assert.deepEqual(quads[0]?.slice(0, 4), [8, 453.25, 12.5, 18.75]);
  assert.deepEqual(quads[2]?.slice(0, 4), [33, 453.25, 6.25, 18.75]);
});

test("osu combo flashes and hands off the incremented value like stable", () => {
  const digit = sprite("digit");
  const x = sprite("x", 10, 30);
  const combo = new OsuComboRenderer({ sprites: { digit, x },
    comboGlyphs: { ...Object.fromEntries([..."0123456789"].map((value) => [value, "digit"])), x: "x" },
    comboOverlap: 0 });
  const early: Parameters<Parameters<OsuComboRenderer["draw"]>[5]>[] = [];
  combo.draw(13, 0, 12, 8, 472, (...quad) => early.push(quad));
  assert.equal(early.length, 6);
  assert.ok(Math.abs(early[0]![2] - 12.5) < 1e-12);
  assert.ok(Math.abs(early[3]![2] - 19.53125) < 1e-12);
  assert.equal(early[3]![4][3], 0.6);

  const handoff: Parameters<Parameters<OsuComboRenderer["draw"]>[5]>[] = [];
  combo.draw(13, 0.185, 12, 8, 472, (...quad) => handoff.push(quad));
  assert.equal(handoff.length, 6);
  assert.ok(Math.abs(handoff[0]![2] - 12.79296875) < 1e-12);
  assert.ok(Math.abs(handoff[3]![4][3] - 0.23) < 1e-12);
});
