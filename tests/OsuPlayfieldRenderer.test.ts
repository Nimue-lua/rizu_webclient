import assert from "node:assert/strict";
import test from "node:test";
import { osuApproachPreempt, osuCircleDiameter } from "../src/gameplay/OsuCircleGeometry";
import { OsuPlayfieldRenderer } from "../src/gameplay/renderer/OsuPlayfieldRenderer";
import type { OsuStandardSkin } from "../src/gameplay/renderer/OsuSkin";
import { OsuViewport } from "../src/gameplay/OsuViewport";
import { OsuCircleState } from "../src/gameplay/OsuCircleState";

test("calculates osu approach preempt and circle size", () => {
  assert.equal(osuApproachPreempt(0), 1.8);
  assert.equal(osuApproachPreempt(5), 1.2);
  assert.ok(Math.abs(osuApproachPreempt(10) - 0.45) < 1e-12);
  assert.ok(Math.abs(osuCircleDiameter(5) - 64) < 1e-12);
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

test("renders pending circles through their late window and hides resolved circles", () => {
  const sprite = {} as OsuStandardSkin["hitCircle"];
  const skin = {
    hitCircle: sprite,
    hitCircleOverlay: sprite,
    approachCircle: sprite,
    comboColor: [1, 1, 1],
  } as unknown as OsuStandardSkin;
  const playfield = new OsuPlayfieldRenderer(skin);
  const chart = {
    mode: "osu",
    approach_rate: 5,
    circle_size: 5,
    overall_difficulty: 5,
    hp_drain_rate: 5,
    object_count: 1,
    drain_length_seconds: 1,
    end_time: 1,
    primary_tempo: 120,
    circles: [{ x: 256, y: 192, absolute_time: 1 }],
  } as const;
  const viewport = new OsuViewport(640, 480);
  const pending_quads: unknown[] = [];
  playfield.draw(viewport, chart, new Uint8Array([OsuCircleState.Pending]), 0, 1.1,
    (...quad) => pending_quads.push(quad));
  assert.equal(pending_quads.length, 3);

  const resolved_quads: unknown[] = [];
  playfield.draw(viewport, chart, new Uint8Array([OsuCircleState.Hit]), 0, 1.1,
    (...quad) => resolved_quads.push(quad));
  assert.equal(resolved_quads.length, 0);
});

test("draws only the supplied active circle range", () => {
  const sprite = {} as OsuStandardSkin["hitCircle"];
  const skin = {
    hitCircle: sprite,
    hitCircleOverlay: sprite,
    approachCircle: sprite,
    comboColor: [1, 1, 1],
  } as unknown as OsuStandardSkin;
  const circles = Array.from({ length: 10_000 }, (_, index) => ({ x: 256, y: 192, absolute_time: index }));
  const chart = {
    mode: "osu", approach_rate: 5, circle_size: 5, overall_difficulty: 5, hp_drain_rate: 5,
    object_count: circles.length, drain_length_seconds: circles.length, end_time: circles.length,
    primary_tempo: 120, circles,
  } as const;
  const quads: unknown[] = [];
  new OsuPlayfieldRenderer(skin).draw(new OsuViewport(640, 480), chart,
    new Uint8Array(circles.length), 9_000, 9_000, (...quad) => quads.push(quad));
  assert.equal(quads.length, 6);
});
