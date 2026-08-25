import assert from "node:assert/strict";
import test from "node:test";
import { approachPreempt, circleDiameter, OsuPlayfieldRenderer } from "../src/gameplay/renderer/OsuPlayfieldRenderer";
import type { OsuStandardSkin } from "../src/gameplay/renderer/OsuSkin";
import { OsuViewport } from "../src/gameplay/OsuViewport";

test("calculates osu approach preempt and circle size", () => {
  assert.equal(approachPreempt(0), 1.8);
  assert.equal(approachPreempt(5), 1.2);
  assert.ok(Math.abs(approachPreempt(10) - 0.45) < 1e-12);
  assert.ok(Math.abs(circleDiameter(5) - 64) < 1e-12);
});

test("centers the 640 by 480 stage and only scales it down", () => {
  const wide = new OsuViewport(1280, 720);
  assert.equal(wide.scale, 1);
  assert.equal(wide.stage_left, 320);
  assert.equal(wide.stage_top, 120);
  const small = new OsuViewport(320, 240);
  assert.equal(small.scale, 0.5);
  assert.equal(small.stage_left, 0);
  assert.equal(small.stage_top, 0);
});
