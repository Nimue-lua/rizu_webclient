import assert from "node:assert/strict";
import test from "node:test";
import { resizeGameplayCanvas } from "../src/gameplay/renderer/GameplayFrame";

test("keeps logical coordinates stable while DPR changes framebuffer size", () => {
  const canvas = { clientWidth: 1280, clientHeight: 720, width: 0, height: 0 } as HTMLCanvasElement;
  const regular = resizeGameplayCanvas(canvas, 1);
  assert.deepEqual(regular, {
    framebuffer_width: 1280,
    framebuffer_height: 720,
    logical_width: 2560 / 3,
    logical_height: 480,
  });
  const high_dpi = resizeGameplayCanvas(canvas, 2);
  assert.equal(high_dpi.framebuffer_width, 2560);
  assert.equal(high_dpi.framebuffer_height, 1440);
  assert.equal(high_dpi.logical_width, regular.logical_width);
  assert.equal(high_dpi.logical_height, regular.logical_height);
});

test("uses a safe DPR and minimum framebuffer dimensions", () => {
  const canvas = { clientWidth: 0, clientHeight: 0, width: 0, height: 0 } as HTMLCanvasElement;
  const frame = resizeGameplayCanvas(canvas, Number.NaN);
  assert.equal(frame.framebuffer_width, 1);
  assert.equal(frame.framebuffer_height, 1);
  assert.equal(frame.logical_width, 480);
});
