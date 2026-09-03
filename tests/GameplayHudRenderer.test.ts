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
    .drawScore({ score: 12345678, accuracy: 100 }, { scoreRight: 848, scoreTop: 0, width: 854, height: 480 });
  assert.deepEqual(names.slice(0, 8), [..."12345678"].map((digit) => `glyph-${digit}`));
});

test("rounds the animated score up", () => {
  const names: string[] = [];
  const { sprites, glyphs } = createHud();
  new SpriteGameplayHudRenderer({ sprites, scoreGlyphs: glyphs, scoreOverlap: 0 },
    (_x, _y, _width, _height, _color, drawn) => names.push((drawn as Sprite & { name: string }).name))
    .drawScore({ score: 1.01, accuracy: 100 }, { scoreRight: 848, scoreTop: 0, width: 854, height: 480 });
  assert.deepEqual(names.slice(0, 7), [..."0000002"].map((digit) => `glyph-${digit}`));
});

test("tolerates skins without global HUD assets", () => {
  assert.doesNotThrow(() => new SpriteGameplayHudRenderer({ sprites: {} }, () => {})
    .drawScore({ score: 0, accuracy: 0 }, { scoreRight: 848, scoreTop: 0, width: 854, height: 480 }));
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
  assert.deepEqual(getGameplayHudLayout(1280), { scoreRight: 1274, scoreTop: 0, width: 1280, height: 480 });
});

test("draws green intro progress beneath the circular metre overlay", () => {
  const { sprites, glyphs } = createHud();
  const fill = sprite("white", 1, 1);
  const overlay = sprite("circularmetre", 42, 42);
  const draws: Array<{ name: string; color: readonly number[]; progress?: number }> = [];
  new SpriteGameplayHudRenderer({ sprites, scoreGlyphs: glyphs, progressFill: fill, progressOverlay: overlay },
    (_x, _y, _width, _height, color, drawn, _flip, _batch, _rotate, _radians, progress) => draws.push({
      name: (drawn as Sprite & { name: string }).name, color, progress,
    })).drawProgress(-0.5, { scoreRight: 848, scoreTop: 0, width: 854, height: 480 });
  assert.deepEqual(draws.map((draw) => draw.name), ["white", "circularmetre"]);
  assert.deepEqual(draws[0]?.color, [199 / 255, 1, 47 / 255, 0.6]);
  assert.equal(draws[0]?.progress, -0.5);
});

test("draws only full-height translucent hit error ticks", () => {
  const fill = sprite("white", 1, 1);
  const arrow = sprite("editor-rate-arrow", 10, 20);
  const draws: Array<{ x: number; y: number; width: number; height: number; name: string;
    color: readonly number[]; additive?: boolean }> = [];
  new SpriteGameplayHudRenderer({ sprites: {}, hitErrorFill: fill, hitErrorArrow: arrow },
    (x, y, width, height, color, drawn, _flip, _batch, _rotate, _radians, _progress, additive) => draws.push({
      x, y, width, height, color, additive, name: (drawn as Sprite & { name: string }).name,
    }), { enabled: true, type: "fullscreen", scale: 1 }).drawHitErrorMeter({
      windows: [0.05, 0.1, 0.15], ticks: [{ deltaTime: 0.075, age: 0 }], floatingError: 0.015, age: 0,
    }, { scoreRight: 848, scoreTop: 0, width: 854, height: 480 });
  assert.equal(draws.length, 1);
  assert.ok(Math.abs(draws[0]!.x - (427 + Math.sqrt(0.5) * 427 - 2.5)) < 1e-12);
  assert.deepEqual({ ...draws[0], x: undefined }, {
    x: undefined, y: 0, width: 5, height: 480,
    color: [1, 0, 0, 0.6], additive: true, name: "white",
  });
});

test("hides the hit error meter after stable's four second delay and fade", () => {
  let draws = 0;
  new SpriteGameplayHudRenderer({ sprites: {}, hitErrorFill: sprite("white") }, () => draws += 1)
    .drawHitErrorMeter({ windows: [0.05, 0.1, 0.15], ticks: [], floatingError: 0, age: 4.6 },
      { scoreRight: 848, scoreTop: 0, width: 854, height: 480 });
  assert.equal(draws, 0);
});

test("does not draw the hit error meter when disabled", () => {
  let draws = 0;
  new SpriteGameplayHudRenderer({ sprites: {}, hitErrorFill: sprite("white") }, () => draws += 1,
    { enabled: false, type: "normal", scale: 1 })
    .drawHitErrorMeter({ windows: [0.05, 0.1, 0.15], ticks: [], floatingError: 0, age: 0 },
      { scoreRight: 848, scoreTop: 0, width: 854, height: 480 });
  assert.equal(draws, 0);
});

test("draws early hits green and late hits red", () => {
  const draws: Array<{ height: number; color: readonly number[] }> = [];
  new SpriteGameplayHudRenderer({ sprites: {}, hitErrorFill: sprite("white", 1, 1) },
    (_x, _y, _width, height, color) => draws.push({ height, color }),
    { enabled: true, type: "fullscreen", scale: 1 })
    .drawHitErrorMeter({
      windows: [0.05, 0.1, 0.15],
      ticks: [{ deltaTime: -0.025, age: 0 }, { deltaTime: 0.025, age: 0 }],
      floatingError: 0,
      age: 0,
    }, { scoreRight: 848, scoreTop: 0, width: 854, height: 480 });
  assert.deepEqual(draws, [
    { height: 480, color: [87 / 255, 227 / 255, 19 / 255, 0.08] },
    { height: 480, color: [1, 0, 0, 0.08] },
  ]);
});

test("fades hits within 16ms toward an invisible perfect hit", () => {
  const draws: number[][] = [];
  new SpriteGameplayHudRenderer({ sprites: {}, hitErrorFill: sprite("white", 1, 1) },
    (_x, _y, _width, _height, color) => draws.push([...color]),
    { enabled: true, type: "fullscreen", scale: 1 })
    .drawHitErrorMeter({
      windows: [0.05, 0.1, 0.15],
      ticks: [
        { deltaTime: -0.016, age: 0 },
        { deltaTime: -0.008, age: 0 },
        { deltaTime: 0, age: 0 },
        { deltaTime: 0.008, age: 0 },
        { deltaTime: 0.016, age: 0 },
      ],
      floatingError: 0,
      age: 0,
    }, { scoreRight: 848, scoreTop: 0, width: 854, height: 480 });
  assert.deepEqual(draws.map((color) => color[3]),
    [4 / 15, 1 / 15, 0, 1 / 15, 4 / 15]);
});

test("fullscreen hit error ticks stop rendering after 133ms", () => {
  const alphas: number[] = [];
  new SpriteGameplayHudRenderer({ sprites: {}, hitErrorFill: sprite("white", 1, 1) },
    (_x, _y, _width, _height, color) => alphas.push(color[3]!),
    { enabled: true, type: "fullscreen", scale: 1 })
    .drawHitErrorMeter({
      windows: [0.05, 0.1, 0.15],
      ticks: [{ deltaTime: 0.075, age: 0 }, { deltaTime: 0.075, age: 0.0665 }, { deltaTime: 0.075, age: 0.3 }],
      floatingError: 0,
      age: 0,
    }, { scoreRight: 848, scoreTop: 0, width: 854, height: 480 });
  assert.deepEqual(alphas, [0.6, 0.46699999999999997]);
});

test("restores the normal hit error bands, ticks, center, and arrow", () => {
  const fill = sprite("white", 1, 1);
  const arrow = sprite("editor-rate-arrow", 10, 20);
  const draws: Array<{ x: number; y: number; width: number; height: number; name: string }> = [];
  new SpriteGameplayHudRenderer({ sprites: {}, hitErrorFill: fill, hitErrorArrow: arrow },
    (x, y, width, height, _color, drawn) => draws.push({
      x, y, width, height, name: (drawn as Sprite & { name: string }).name,
    }), { enabled: true, type: "normal", scale: 1 }).drawHitErrorMeter({
      windows: [0.05, 0.1, 0.15], ticks: [{ deltaTime: 0.075, age: 0 }], floatingError: 0.015, age: 0,
    }, { scoreRight: 848, scoreTop: 0, width: 854, height: 480 });
  assert.deepEqual(draws.map((draw) => draw.name),
    ["white", "white", "white", "white", "white", "white", "editor-rate-arrow"]);
  for (const [actual, expected] of draws.slice(0, 5).map((draw) => draw.width)
    .map((width, index) => [width, [384, 240, 160, 80, 2.4][index]!] as const)) {
    assert.ok(Math.abs(actual - expected) < 1e-12);
  }
  assert.equal(draws[5]?.x, 485.5);
  assert.equal(draws[6]?.x, 436);
  assert.equal(draws[6]?.y, 459);
});

test("does not scale full-height hit error ticks", () => {
  const fill = sprite("white", 1, 1);
  const arrow = sprite("editor-rate-arrow", 10, 20);
  const drawAtScale = (scale: number) => {
    const draws: Array<{ x: number; y: number; width: number; height: number }> = [];
    new SpriteGameplayHudRenderer({ sprites: {}, hitErrorFill: fill, hitErrorArrow: arrow },
      (x, y, width, height) => draws.push({ x, y, width, height }), { enabled: true, type: "fullscreen", scale })
      .drawHitErrorMeter({
        windows: [0.05, 0.1, 0.15], ticks: [{ deltaTime: 0.075, age: 0 }], floatingError: 0, age: 0,
      }, { scoreRight: 848, scoreTop: 0, width: 854, height: 480 });
    return draws;
  };
  const half = drawAtScale(0.5);
  const double = drawAtScale(2);
  assert.deepEqual(half, double);
  assert.equal(half[0]?.width, 5);
  assert.equal(half[0]?.height, 480);
});
