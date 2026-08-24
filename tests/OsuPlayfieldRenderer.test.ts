import assert from "node:assert/strict";
import test from "node:test";
import { approachPreempt, circleDiameter, OsuPlayfieldRenderer } from "../src/gameplay/renderer/OsuPlayfieldRenderer";
import type { OsuStandardSkin } from "../src/gameplay/renderer/OsuSkin";

test("calculates osu approach preempt and circle size", () => {
  assert.equal(approachPreempt(0), 1.8);
  assert.equal(approachPreempt(5), 1.2);
  assert.ok(Math.abs(approachPreempt(10) - 0.45) < 1e-12);
  assert.ok(Math.abs(circleDiameter(5) - 64) < 1e-12);
});

test("centers the 640 by 480 stage and only scales it down", () => {
  const renderer = new OsuPlayfieldRenderer(null as unknown as OsuStandardSkin);
  assert.deepEqual(renderer.getLayout(1280, 720), { width: 1280, height: 720, scale: 1, left: 320, top: 120 });
  assert.deepEqual(renderer.getLayout(320, 240), { width: 320, height: 240, scale: 0.5, left: 0, top: 0 });
});
