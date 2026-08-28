import assert from "node:assert/strict";
import test from "node:test";
import { SpriteGameplayHudRenderer } from "../src/gameplay/renderer/GameplayHudRenderer";
import { getGameplayHudLayout } from "../src/gameplay/GameplayHudRenderer";
import type { Sprite } from "../src/gameplay/renderer/Sprite";

function sprite(name: string, width = 20, height = 30): Sprite & { name: string } {
  return { name, image: {} as ImageBitmap, sourceSize: { w: width, h: height }, pixelSize: { w: width, h: height } };
}

function createHud() {
  const sprites: Record<string, Sprite & { name: string }> = {};
  const glyphs: Record<string, string> = {};
  for (const character of "0123456789.%") {
    const name = `glyph-${character}`;
    glyphs[character] = name;
    sprites[name] = sprite(name);
  }
  return { sprites, glyphs };
}

test("formats the actual score without truncating values over seven digits", () => {
  const names: string[] = [];
  const { sprites, glyphs } = createHud();
  new SpriteGameplayHudRenderer({ sprites, scoreGlyphs: glyphs, scoreOverlap: 0 },
    (_x, _y, _width, _height, _color, drawn) => names.push((drawn as Sprite & { name: string }).name))
    .drawScore({ score: 12345678, accuracy: 100 }, { scoreRight: 848, scoreTop: 0 });
  assert.deepEqual(names.slice(0, 8), [..."12345678"].map((digit) => `glyph-${digit}`));
});

test("tolerates skins without global HUD assets", () => {
  assert.doesNotThrow(() => new SpriteGameplayHudRenderer({ sprites: {} }, () => {})
    .drawScore({ score: 0, accuracy: 0 }, { scoreRight: 848, scoreTop: 0 }));
});

test("draws the osu HP background and full HP fill at native HUD positions", () => {
  const background = sprite("scorebar-bg", 200, 20);
  const fill = sprite("scorebar-colour", 180, 8);
  const draws: Array<{ x: number; y: number; width: number; height: number; name: string }> = [];
  new SpriteGameplayHudRenderer({ sprites: {}, hpBackground: background, hpFill: fill },
    (x, y, width, height, _color, drawn) => draws.push({
      x, y, width, height, name: (drawn as Sprite & { name: string }).name,
    })).drawHpBar();
  assert.deepEqual(draws, [
    { x: 0, y: 0, width: 125, height: 12.5, name: "scorebar-bg" },
    { x: 7.5, y: 7.8, width: 112.5, height: 5, name: "scorebar-colour" },
  ]);
});

test("anchors the global HUD to the viewport instead of a letterboxed playfield", () => {
  assert.deepEqual(getGameplayHudLayout(1280), { scoreRight: 1274, scoreTop: 0 });
});

test("draws green intro progress beneath the circular metre overlay", () => {
  const { sprites, glyphs } = createHud();
  const fill = sprite("white", 1, 1);
  const overlay = sprite("circularmetre", 42, 42);
  const draws: Array<{ name: string; color: readonly number[]; progress?: number }> = [];
  new SpriteGameplayHudRenderer({ sprites, scoreGlyphs: glyphs, progressFill: fill, progressOverlay: overlay },
    (_x, _y, _width, _height, color, drawn, _flip, _batch, _rotate, _radians, progress) => draws.push({
      name: (drawn as Sprite & { name: string }).name, color, progress,
    })).drawProgress(-0.5, { scoreRight: 848, scoreTop: 0 });
  assert.deepEqual(draws.map((draw) => draw.name), ["white", "circularmetre"]);
  assert.deepEqual(draws[0]?.color, [199 / 255, 1, 47 / 255, 0.6]);
  assert.equal(draws[0]?.progress, -0.5);
});
