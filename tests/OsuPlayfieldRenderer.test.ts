import assert from "node:assert/strict";
import test from "node:test";
import { osuApproachPreempt, osuCircleDiameter } from "../src/gameplay/OsuCircleGeometry";
import { OsuPlayfieldRenderer, stableShakeOffset } from "../src/gameplay/renderer/OsuPlayfieldRenderer";
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
    slider_multiplier: 1.4, timing_points: [],
    hit_objects: [{ kind: "circle", x: 256, y: 192, absolute_time: 1, hit_sound: 0,
      hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" } }],
  } as const;
  const viewport = new OsuViewport(640, 480);
  const pending_quads: unknown[] = [];
  playfield.draw(viewport, chart, new Uint8Array([OsuCircleState.Pending]), 0, [], 1.1,
    (...quad) => pending_quads.push(quad));
  assert.equal(pending_quads.length, 3);

  const resolved_quads: unknown[] = [];
  playfield.draw(viewport, chart, new Uint8Array([OsuCircleState.Hit]), 0, [], 1.1,
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
  const circles = Array.from({ length: 10_000 }, (_, index) => ({ kind: "circle" as const,
    x: 256, y: 192, absolute_time: index, hit_sound: 0,
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" } }));
  const chart = {
    mode: "osu", approach_rate: 5, circle_size: 5, overall_difficulty: 5, hp_drain_rate: 5,
    object_count: circles.length, drain_length_seconds: circles.length, end_time: circles.length,
    primary_tempo: 120, slider_multiplier: 1.4, timing_points: [], hit_objects: circles,
  } as const;
  const quads: unknown[] = [];
  new OsuPlayfieldRenderer(skin).draw(new OsuViewport(640, 480), chart,
    new Uint8Array(circles.length), 9_000, [], 9_000, (...quad) => quads.push(quad));
  assert.equal(quads.length, 6);
});

test("matches stable hit fade-out and note-lock shake", () => {
  const hit_circle = { sourceSize: { w: 64, h: 64 } } as OsuStandardSkin["hitCircle"];
  const overlay = { sourceSize: { w: 64, h: 64 } } as OsuStandardSkin["hitCircleOverlay"];
  const judgment = { sourceSize: { w: 100, h: 50 } } as OsuStandardSkin["hitCircle"];
  const skin = {
    sprites: { hit300: judgment }, hitCircle: hit_circle, hitCircleOverlay: overlay,
    approachCircle: overlay, comboColor: [1, 1, 1, 1], judgments: { "300": ["hit300"] },
  } as unknown as OsuStandardSkin;
  const chart = {
    mode: "osu", approach_rate: 5, circle_size: 5, overall_difficulty: 5, hp_drain_rate: 5,
    object_count: 1, drain_length_seconds: 1, end_time: 1, primary_tempo: 120,
    slider_multiplier: 1.4, timing_points: [],
    hit_objects: [{ kind: "circle", x: 256, y: 192, absolute_time: 1, hit_sound: 0,
      hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" } }],
  } as const;
  const quads: Parameters<Parameters<OsuPlayfieldRenderer["draw"]>[6]>[] = [];
  new OsuPlayfieldRenderer(skin).draw(new OsuViewport(640, 480), chart,
    new Uint8Array([OsuCircleState.Hit]), 1,
    [{ kind: "hit", object_index: 0, start_time: 1, judgment: "300" }], 1.12,
    (...quad) => quads.push(quad));
  assert.ok(Math.abs(quads[0]![2] - 83.2) < 1e-9);
  assert.ok(Math.abs(quads[0]![4][3] - 0.5) < 1e-9);
  assert.equal(quads.length, 3);

  assert.equal(stableShakeOffset(0), 0);
  assert.equal(stableShakeOffset(0.02), 8);
  assert.equal(stableShakeOffset(0.04), -8);
  assert.equal(stableShakeOffset(0.06), 8);
  assert.equal(stableShakeOffset(0.08), 8);
  assert.equal(stableShakeOffset(0.1), 8);
  assert.equal(stableShakeOffset(0.12), 0);
});

test("renders the stable miss shell fade and local hit0 animation", () => {
  const circle = { sourceSize: { w: 64, h: 64 } } as OsuStandardSkin["hitCircle"];
  const miss = { sourceSize: { w: 65, h: 65 } } as OsuStandardSkin["hitCircle"];
  const skin = {
    sprites: { hit0: miss }, hitCircle: circle, hitCircleOverlay: circle,
    approachCircle: circle, comboColor: [1, 1, 1, 1], judgments: { miss: ["hit0"] },
  } as unknown as OsuStandardSkin;
  const chart = {
    mode: "osu", approach_rate: 5, circle_size: 5, overall_difficulty: 5, hp_drain_rate: 5,
    object_count: 1, drain_length_seconds: 1, end_time: 1, primary_tempo: 120,
    slider_multiplier: 1.4, timing_points: [],
    hit_objects: [{ kind: "circle", x: 256, y: 192, absolute_time: 1, hit_sound: 0,
      hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" } }],
  } as const;
  const quads: Parameters<Parameters<OsuPlayfieldRenderer["draw"]>[6]>[] = [];
  new OsuPlayfieldRenderer(skin).draw(new OsuViewport(640, 480), chart,
    new Uint8Array([OsuCircleState.Missed]), 1,
    [{ kind: "miss", object_index: 0, start_time: 1 }], 1.03,
    (...quad) => quads.push(quad));
  assert.equal(quads.length, 3);
  assert.ok(Math.abs(quads[0]![4][3] - 0.5) < 1e-9);
  assert.ok(Math.abs(quads[2]![2] - 113.75) < 1e-9);
  assert.ok(Math.abs(quads[2]![4][3] - 0.25) < 1e-9);
});
