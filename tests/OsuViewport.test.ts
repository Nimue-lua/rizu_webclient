import assert from "node:assert/strict";
import test from "node:test";
import { OsuViewport } from "../src/gameplay/OsuViewport";
import { resizeGameplayCanvas } from "../src/gameplay/renderer/GameplayFrame";

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test("round trips playfield coordinates across aspect ratios", () => {
  for (const [width, height] of [[640, 480], [1280, 720], [320, 640], [1000, 300]]) {
    const viewport = new OsuViewport(width!, height!);
    for (const point of [{ x: 0, y: 0 }, { x: 256, y: 192 }, { x: 512, y: 384 }]) {
      const restored = viewport.screenToPlayfield(viewport.playfieldToScreen(point));
      close(restored.x, point.x);
      close(restored.y, point.y);
    }
  }
});

test("maps client coordinates through canvas bounds and letterboxing exactly once", () => {
  const viewport = new OsuViewport(960, 480);
  const bounds = { left: 100, top: 50, width: 1920, height: 960 };
  const screen = viewport.playfieldToScreen({ x: 256, y: 192 });
  const point = viewport.clientToPlayfield({
    x: bounds.left + screen.x / viewport.logical_width * bounds.width,
    y: bounds.top + screen.y / viewport.logical_height * bounds.height,
  }, bounds);
  close(point.x, 256);
  close(point.y, 192);
});

test("applies coordinate flips symmetrically", () => {
  const viewport = new OsuViewport(640, 480, true, true);
  const screen = viewport.playfieldToScreen({ x: 10, y: 20 });
  const normal = new OsuViewport(640, 480).playfieldToScreen({ x: 502, y: 364 });
  assert.deepEqual(screen, normal);
  assert.deepEqual(viewport.screenToPlayfield(screen), { x: 10, y: 20 });
});

test("keeps logical pointer coordinates independent from DPR rounding", () => {
  const canvas = { clientWidth: 333, clientHeight: 200, width: 0, height: 0 } as HTMLCanvasElement;
  const one = resizeGameplayCanvas(canvas, 1);
  const fractional = resizeGameplayCanvas(canvas, 1.25);
  const two = resizeGameplayCanvas(canvas, 2);
  close(one.logical_width, fractional.logical_width);
  close(one.logical_width, two.logical_width);
  assert.notEqual(one.framebuffer_width, two.framebuffer_width);
});

test("rejects unusable viewport and DOM bounds", () => {
  assert.throws(() => new OsuViewport(0, 480), /positive/);
  assert.throws(() => new OsuViewport(640, 480).clientToPlayfield({ x: 0, y: 0 },
    { left: 0, top: 0, width: 0, height: 1 }), /positive/);
});
