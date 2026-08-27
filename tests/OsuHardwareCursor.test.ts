import assert from "node:assert/strict";
import test from "node:test";
import { osuCursorRendererMode, osuHardwareCursorSize } from "../src/gameplay/osu/OsuHardwareCursor";
import type { Sprite } from "../src/gameplay/renderer/Sprite";

const cursor = { sourceSize: { w: 60, h: 60 } } as Sprite;

test("defaults to the OS cursor and accepts the WebGL renderer", () => {
  assert.equal(osuCursorRendererMode(null), "os");
  assert.equal(osuCursorRendererMode("os"), "os");
  assert.equal(osuCursorRendererMode("webgl"), "webgl");
  assert.equal(osuCursorRendererMode("invalid"), "os");
});

test("sizes the hardware cursor like the gameplay stage", () => {
  assert.deepEqual(osuHardwareCursorSize(cursor, 640, 480, 1), { width: 60, height: 60 });
  assert.deepEqual(osuHardwareCursorSize(cursor, 320, 240, 1.5), { width: 45, height: 45 });
});

test("limits hardware cursors to browser-supported dimensions", () => {
  assert.deepEqual(osuHardwareCursorSize(cursor, 1920, 1080, 1), { width: 128, height: 128 });
  const wide_cursor = { sourceSize: { w: 80, h: 40 } } as Sprite;
  assert.deepEqual(osuHardwareCursorSize(wide_cursor, 1920, 1080, 1), { width: 128, height: 64 });
});
