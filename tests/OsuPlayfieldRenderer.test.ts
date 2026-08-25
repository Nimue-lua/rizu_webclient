import assert from "node:assert/strict";
import test from "node:test";
import { osuApproachPreempt, osuCircleDiameter } from "../src/gameplay/OsuCircleGeometry";
import { OsuPlayfieldRenderer, stableShakeOffset } from "../src/gameplay/renderer/OsuPlayfieldRenderer";
import type { OsuStandardSkin } from "../src/gameplay/renderer/OsuSkin";
import { OsuViewport } from "../src/gameplay/OsuViewport";
import { OsuCircleState } from "../src/gameplay/OsuCircleState";
import { OsuSliderPath } from "../src/gameplay/OsuSliderPath";
import type { OsuSlider } from "../src/chart/Chart";

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
    format_version: 14,
    approach_rate: 5,
    circle_size: 5,
    overall_difficulty: 5,
    hp_drain_rate: 5,
    object_count: 1,
    drain_length_seconds: 1,
    end_time: 1,
    primary_tempo: 120,
    slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [],
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
    mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, overall_difficulty: 5, hp_drain_rate: 5,
    object_count: circles.length, drain_length_seconds: circles.length, end_time: circles.length,
    primary_tempo: 120, slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [], hit_objects: circles,
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
    mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, overall_difficulty: 5, hp_drain_rate: 5,
    object_count: 1, drain_length_seconds: 1, end_time: 1, primary_tempo: 120,
    slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [],
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
    mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, overall_difficulty: 5, hp_drain_rate: 5,
    object_count: 1, drain_length_seconds: 1, end_time: 1, primary_tempo: 120,
    slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [],
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

test("requests visible slider bodies and draws repeat-aware head and end circles", () => {
  const sprite = {} as OsuStandardSkin["hitCircle"];
  const slider_end = {} as OsuStandardSkin["hitCircle"];
  const skin = { hitCircle: sprite, hitCircleOverlay: sprite, approachCircle: sprite,
    sliderEndCircle: slider_end, sliderEndCircleOverlay: null,
    comboColor: [1, 1, 1, 1] } as unknown as OsuStandardSkin;
  const slider: OsuSlider = {
    kind: "slider", x: 100, y: 100, absolute_time: 1, hit_sound: 0, curve_type: "linear",
    control_points: [{ x: 200, y: 100 }], repeat_count: 1, pixel_length: 100,
    edge_sounds: [0, 0], edge_sets: [{ normal_set: 0, addition_set: 0 }, { normal_set: 0, addition_set: 0 }],
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    span_duration: 0.5, total_duration: 0.5, end_time: 1.5, tick_distances: [],
  };
  const chart = { mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, overall_difficulty: 5,
    hp_drain_rate: 5, object_count: 1, drain_length_seconds: 1, end_time: 1.5, primary_tempo: 120,
    slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [], hit_objects: [slider] } as const;
  const path = OsuSliderPath.create(slider, 14);
  const bodies: OsuSlider[] = [];
  const quads: unknown[] = [];
  new OsuPlayfieldRenderer(skin).draw(new OsuViewport(640, 480), chart, new Uint8Array(1), 1, [], 0.5,
    (...quad) => quads.push(quad), () => path, (object) => bodies.push(object));
  assert.deepEqual(bodies, [slider]);
  assert.equal(quads.length, 4);
  const endpoint_quad = quads[0] as [number, number];
  assert.equal(endpoint_quad[0], 64 + 200 - 32);
  assert.equal((quads[0] as unknown[])[5], slider_end);
});

test("orders circles around slider bodies and foreground graphics by object time", () => {
  const hit_circle = { sourceSize: { w: 64, h: 64 } } as OsuStandardSkin["hitCircle"];
  const slider_end = { sourceSize: { w: 64, h: 64 } } as OsuStandardSkin["hitCircle"];
  const skin = { hitCircle: hit_circle, hitCircleOverlay: hit_circle, approachCircle: hit_circle,
    sliderEndCircle: slider_end, sliderEndCircleOverlay: null,
    comboColor: [1, 1, 1, 1] } as unknown as OsuStandardSkin;
  const slider: OsuSlider = {
    kind: "slider", x: 100, y: 100, absolute_time: 1, hit_sound: 0, curve_type: "linear",
    control_points: [{ x: 200, y: 100 }], repeat_count: 1, pixel_length: 100,
    edge_sounds: [0, 0], edge_sets: [{ normal_set: 0, addition_set: 0 }, { normal_set: 0, addition_set: 0 }],
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    span_duration: 1, total_duration: 1, end_time: 2, tick_distances: [],
  };
  const early_circle = { kind: "circle" as const, x: 50, y: 100, absolute_time: 0.75, hit_sound: 0,
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" } };
  const late_circle = { kind: "circle" as const, x: 150, y: 100, absolute_time: 1.5, hit_sound: 0,
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" } };
  const chart = { mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, overall_difficulty: 5,
    hp_drain_rate: 5, object_count: 3, drain_length_seconds: 2, end_time: 2, primary_tempo: 120,
    slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [],
    hit_objects: [early_circle, slider, late_circle] } as const;
  const path = OsuSliderPath.create(slider, 14);
  const order: string[] = [];
  new OsuPlayfieldRenderer(skin).draw(new OsuViewport(640, 480), chart,
    new Uint8Array(3), 0, [], 1.25,
    (...quad) => order.push(quad[0] === 64 + early_circle.x - 32 ? "early-circle"
      : quad[0] === 64 + late_circle.x - 32 ? "late-circle" : "slider-foreground"),
    () => path, () => order.push("slider-body"));

  assert.ok(order.indexOf("slider-body") > order.lastIndexOf("late-circle"));
  assert.ok(order.indexOf("slider-foreground") > order.lastIndexOf("late-circle"));
  assert.ok(order.indexOf("early-circle") > order.lastIndexOf("slider-foreground"));
});

test("draws overlapping sliders as complete objects in reverse order", () => {
  const circle = { sourceSize: { w: 64, h: 64 } } as OsuStandardSkin["hitCircle"];
  const skin = { hitCircle: circle, hitCircleOverlay: circle, approachCircle: circle,
    comboColor: [1, 1, 1, 1], sliderBallFrames: [] } as unknown as OsuStandardSkin;
  const slider = (x: number, absolute_time: number): OsuSlider => ({
    kind: "slider", x, y: 100, absolute_time, hit_sound: 0, curve_type: "linear",
    control_points: [{ x: x + 100, y: 100 }], repeat_count: 1, pixel_length: 100,
    edge_sounds: [0, 0], edge_sets: [{ normal_set: 0, addition_set: 0 }, { normal_set: 0, addition_set: 0 }],
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    span_duration: 1, total_duration: 1, end_time: absolute_time + 1, tick_distances: [],
  });
  const early = slider(100, 1);
  const late = slider(120, 1.5);
  const chart = { mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, overall_difficulty: 5,
    hp_drain_rate: 5, object_count: 2, drain_length_seconds: 2.5, end_time: 2.5, primary_tempo: 120,
    slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [],
    hit_objects: [early, late] } as const;
  const paths = new Map([[early, OsuSliderPath.create(early, 14)], [late, OsuSliderPath.create(late, 14)]]);
  const order: string[] = [];
  new OsuPlayfieldRenderer(skin).draw(new OsuViewport(640, 480), chart, new Uint8Array(2), 0, [], 1.6,
    (...quad) => order.push(quad[0] === 64 + late.x - 32 || quad[0] === 64 + late.x + 100 - 32
      ? "late-sprite" : "early-sprite"),
    (object) => paths.get(object), (object) => order.push(object === late ? "late-body" : "early-body"));

  assert.ok(order.indexOf("early-body") > order.lastIndexOf("late-sprite"));
  assert.ok(order.indexOf("early-sprite") > order.indexOf("early-body"));
});

test("fades slider bodies and circles for 240ms after their end", () => {
  const sprite = {} as OsuStandardSkin["hitCircle"];
  const skin = { hitCircle: sprite, hitCircleOverlay: sprite, approachCircle: sprite,
    comboColor: [1, 1, 1, 1] } as unknown as OsuStandardSkin;
  const slider: OsuSlider = {
    kind: "slider", x: 100, y: 100, absolute_time: 1, hit_sound: 0, curve_type: "linear",
    control_points: [{ x: 200, y: 100 }], repeat_count: 1, pixel_length: 100,
    edge_sounds: [0, 0], edge_sets: [{ normal_set: 0, addition_set: 0 }, { normal_set: 0, addition_set: 0 }],
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    span_duration: 0.5, total_duration: 0.5, end_time: 1.5, tick_distances: [],
  };
  const chart = { mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, overall_difficulty: 5,
    hp_drain_rate: 5, object_count: 1, drain_length_seconds: 1, end_time: 1.5, primary_tempo: 120,
    slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [], hit_objects: [slider] } as const;
  const path = OsuSliderPath.create(slider, 14);
  const alphas: number[] = [];
  const quads: Parameters<Parameters<OsuPlayfieldRenderer["draw"]>[6]>[] = [];
  const renderer = new OsuPlayfieldRenderer(skin);
  renderer.draw(new OsuViewport(640, 480), chart, new Uint8Array(1), 1, [], 1.62,
    (...quad) => quads.push(quad), () => path, (_slider, _path, alpha) => alphas.push(alpha));
  assert.ok(Math.abs(alphas[0]! - 0.5) < 1e-9);
  assert.ok(quads.slice(0, 2).every((quad) => Math.abs(quad[4][3] - 0.5) < 1e-9));

  const gone: unknown[] = [];
  renderer.draw(new OsuViewport(640, 480), chart, new Uint8Array(1), 1, [], 1.74,
    (...quad) => gone.push(quad), () => path, () => gone.push("body"));
  assert.deepEqual(gone, []);
});

test("does not flash a resolved slider head during the body end fade", () => {
  const circle = { sourceSize: { w: 64, h: 64 } } as OsuStandardSkin["hitCircle"];
  const skin = { hitCircle: circle, hitCircleOverlay: circle, approachCircle: circle,
    comboColor: [1, 1, 1, 1], sliderBallFrames: [] } as unknown as OsuStandardSkin;
  const slider: OsuSlider = {
    kind: "slider", x: 100, y: 100, absolute_time: 1, hit_sound: 0, curve_type: "linear",
    control_points: [{ x: 200, y: 100 }], repeat_count: 1, pixel_length: 100,
    edge_sounds: [0, 0], edge_sets: [{ normal_set: 0, addition_set: 0 }, { normal_set: 0, addition_set: 0 }],
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    span_duration: 0.5, total_duration: 0.5, end_time: 1.5, tick_distances: [],
  };
  const chart = { mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, overall_difficulty: 5,
    hp_drain_rate: 5, object_count: 1, drain_length_seconds: 1, end_time: 1.5, primary_tempo: 120,
    slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [], hit_objects: [slider] } as const;
  const path = OsuSliderPath.create(slider, 14);
  const quads: Parameters<Parameters<OsuPlayfieldRenderer["draw"]>[6]>[] = [];
  new OsuPlayfieldRenderer(skin).draw(new OsuViewport(640, 480), chart,
    new Uint8Array([OsuCircleState.Hit]), 1, [], 1.62, (...quad) => quads.push(quad),
    () => path, () => undefined, []);

  const start_x = 64 + slider.x - 32;
  assert.equal(quads.some((quad) => quad[0] === start_x && quad[4][3] > 0), false);
  assert.equal(quads.some((quad) => quad[0] === 64 + 200 - 32 && quad[4][3] > 0), true);
});

test("animates the slider ball along repeat-aware path progress", () => {
  const circle = { sourceSize: { w: 64, h: 64 } } as OsuStandardSkin["hitCircle"];
  const ball0 = { sourceSize: { w: 20, h: 20 } } as OsuStandardSkin["hitCircle"];
  const ball1 = { sourceSize: { w: 20, h: 20 } } as OsuStandardSkin["hitCircle"];
  const skin = { hitCircle: circle, hitCircleOverlay: circle, approachCircle: circle,
    comboColor: [1, 1, 1, 1], sliderBallFrames: [ball0, ball1] } as unknown as OsuStandardSkin;
  const slider: OsuSlider = {
    kind: "slider", x: 100, y: 100, absolute_time: 1, hit_sound: 0, curve_type: "linear",
    control_points: [{ x: 200, y: 100 }], repeat_count: 2, pixel_length: 100,
    edge_sounds: [0, 0, 0], edge_sets: [{ normal_set: 0, addition_set: 0 },
      { normal_set: 0, addition_set: 0 }, { normal_set: 0, addition_set: 0 }],
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    span_duration: 0.5, total_duration: 1, end_time: 2, tick_distances: [],
  };
  const chart = { mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, overall_difficulty: 5,
    hp_drain_rate: 5, object_count: 1, drain_length_seconds: 1, end_time: 2, primary_tempo: 120,
    slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [], hit_objects: [slider] } as const;
  const path = OsuSliderPath.create(slider, 14);
  const quads: Parameters<Parameters<OsuPlayfieldRenderer["draw"]>[6]>[] = [];
  new OsuPlayfieldRenderer(skin).draw(new OsuViewport(640, 480), chart, new Uint8Array(1), 1, [], 1.75,
    (...quad) => quads.push(quad), () => path, () => undefined);
  const ball = quads.at(-1)!;
  assert.equal(ball[0], 64 + 150 - 5);
  assert.equal(ball[1], 48 + 100 - 5);
  assert.equal(ball[5], ball0);
});

test("draws slider balls and follow circles only from rules presentation state", () => {
  const circle = { sourceSize: { w: 64, h: 64 } } as OsuStandardSkin["hitCircle"];
  const ball = { sourceSize: { w: 20, h: 20 } } as OsuStandardSkin["hitCircle"];
  const follow = { sourceSize: { w: 128, h: 128 } } as OsuStandardSkin["hitCircle"];
  const skin = { hitCircle: circle, hitCircleOverlay: circle, approachCircle: circle,
    comboColor: [1, 1, 1, 1], sliderBallFrames: [ball], sliderFollowCircle: follow } as unknown as OsuStandardSkin;
  const object = {
    kind: "slider", x: 100, y: 100, absolute_time: 1, hit_sound: 0, curve_type: "linear",
    control_points: [{ x: 200, y: 100 }], repeat_count: 1, pixel_length: 100,
    edge_sounds: [0, 0], edge_sets: [{ normal_set: 0, addition_set: 0 }, { normal_set: 0, addition_set: 0 }],
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    span_duration: 1, total_duration: 1, end_time: 2, tick_distances: [],
  } as OsuSlider;
  const chart = { mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, overall_difficulty: 5,
    hp_drain_rate: 5, object_count: 1, drain_length_seconds: 1, end_time: 2, primary_tempo: 120,
    slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [], hit_objects: [object] } as const;
  const path = OsuSliderPath.create(object, 14);
  const quads: Parameters<Parameters<OsuPlayfieldRenderer["draw"]>[6]>[] = [];
  new OsuPlayfieldRenderer(skin).draw(new OsuViewport(640, 480), chart, new Uint8Array(1), 1, [], 1.5,
    (...quad) => quads.push(quad), () => path, () => undefined,
    [{ object_index: 0, position: { x: 150, y: 100 }, active: true, tracking: true,
      tracking_started_at: 1.5, head_resolved_at: 1, head_successful: true }]);
  assert.equal(quads.filter((quad) => quad[5] === ball).length, 1);
  assert.equal(quads.filter((quad) => quad[5] === follow).length, 1);

  const inactive: Parameters<Parameters<OsuPlayfieldRenderer["draw"]>[6]>[] = [];
  new OsuPlayfieldRenderer(skin).draw(new OsuViewport(640, 480), chart, new Uint8Array(1), 1, [], 1.5,
    (...quad) => inactive.push(quad), () => path, () => undefined, []);
  assert.equal(inactive.some((quad) => quad[5] === ball || quad[5] === follow), false);
});

test("matches stable slider head, ball, and follow-circle activation animations", () => {
  const circle = { sourceSize: { w: 64, h: 64 } } as OsuStandardSkin["hitCircle"];
  const ball = { sourceSize: { w: 20, h: 20 } } as OsuStandardSkin["hitCircle"];
  const follow = { sourceSize: { w: 128, h: 128 } } as OsuStandardSkin["hitCircle"];
  const digit = { sourceSize: { w: 20, h: 40 } } as OsuStandardSkin["hitCircle"];
  const skin = { hitCircle: circle, hitCircleOverlay: circle, approachCircle: circle,
    comboColor: [1, 1, 1, 1], sliderBallFrames: [ball], sliderFollowCircle: follow,
    hitCircleGlyphs: { "1": digit } } as unknown as OsuStandardSkin;
  const object = {
    kind: "slider", x: 100, y: 100, absolute_time: 1, hit_sound: 0, curve_type: "linear",
    control_points: [{ x: 200, y: 100 }], repeat_count: 1, pixel_length: 100,
    edge_sounds: [0, 0], edge_sets: [{ normal_set: 0, addition_set: 0 }, { normal_set: 0, addition_set: 0 }],
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    span_duration: 1, total_duration: 1, end_time: 2, tick_distances: [], combo_number: 1,
  } as OsuSlider;
  const chart = { mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, overall_difficulty: 5,
    hp_drain_rate: 5, object_count: 1, drain_length_seconds: 1, end_time: 2, primary_tempo: 120,
    slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [], hit_objects: [object] } as const;
  const path = OsuSliderPath.create(object, 14);
  const drawAt = (time: number, tracking: boolean, tracking_started_at: number | null) => {
    const quads: Parameters<Parameters<OsuPlayfieldRenderer["draw"]>[6]>[] = [];
    new OsuPlayfieldRenderer(skin).draw(new OsuViewport(640, 480), chart, new Uint8Array(1), 1, [], time,
      (...quad) => quads.push(quad), () => path, () => undefined,
      [{ object_index: 0, position: { x: 100, y: 100 }, active: true, tracking,
        tracking_started_at, head_resolved_at: 0.9, head_successful: true }]);
    return quads;
  };

  const early = drawAt(0.9, false, null);
  assert.equal(early.some((quad) => quad[5] === ball || quad[5] === follow), false);
  assert.equal(early.some((quad) => quad[5] === digit), false);

  const untracked = drawAt(1, false, null);
  assert.equal(untracked.filter((quad) => quad[5] === ball).length, 1);
  assert.equal(untracked.some((quad) => quad[5] === follow), false);
  const head = untracked.filter((quad) => quad[5] === circle).find((quad) => quad[4][3] < 0.59)!;
  const hit_progress = 0.1 / 0.24;
  const expected_head_size = 64 * (1 + 0.4 * (2 * hit_progress - hit_progress * hit_progress));
  assert.ok(Math.abs(head[2] - expected_head_size) < 1e-9);
  assert.ok(Math.abs(head[0] - (64 + 100 - expected_head_size / 2)) < 1e-9);

  const starting = drawAt(1.03, true, 1);
  const follower = starting.find((quad) => quad[5] === follow)!;
  assert.ok(Math.abs(follower[4][3] - 0.5) < 1e-9);
  assert.ok(follower[2] > 32 && follower[2] < 64);
});

test("scales slider balls with circle size", () => {
  const circle = { sourceSize: { w: 64, h: 64 } } as OsuStandardSkin["hitCircle"];
  const ball = { sourceSize: { w: 20, h: 10 } } as OsuStandardSkin["hitCircle"];
  const skin = { hitCircle: circle, hitCircleOverlay: circle, approachCircle: circle,
    comboColor: [1, 1, 1, 1], sliderBallFrames: [ball] } as unknown as OsuStandardSkin;
  const slider: OsuSlider = {
    kind: "slider", x: 100, y: 100, absolute_time: 1, hit_sound: 0, curve_type: "linear",
    control_points: [{ x: 200, y: 100 }], repeat_count: 1, pixel_length: 100,
    edge_sounds: [0, 0], edge_sets: [{ normal_set: 0, addition_set: 0 }, { normal_set: 0, addition_set: 0 }],
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    span_duration: 1, total_duration: 1, end_time: 2, tick_distances: [],
  };
  const chart = { mode: "osu", format_version: 14, approach_rate: 5, circle_size: 2, overall_difficulty: 5,
    hp_drain_rate: 5, object_count: 1, drain_length_seconds: 1, end_time: 2, primary_tempo: 120,
    slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [], hit_objects: [slider] } as const;
  const path = OsuSliderPath.create(slider, 14);
  const quads: Parameters<Parameters<OsuPlayfieldRenderer["draw"]>[6]>[] = [];
  new OsuPlayfieldRenderer(skin).draw(new OsuViewport(640, 480), chart, new Uint8Array(1), 1, [], 1.5,
    (...quad) => quads.push(quad), () => path, () => undefined);
  const ball_quad = quads.at(-1)!;
  const scale = osuCircleDiameter(2) / 128;
  assert.ok(Math.abs(ball_quad[2] - 20 * scale) < 1e-9);
  assert.ok(Math.abs(ball_quad[3] - 10 * scale) < 1e-9);
});

test("draws the next repeat arrow in the outgoing endpoint direction", () => {
  const circle = { sourceSize: { w: 64, h: 64 } } as OsuStandardSkin["hitCircle"];
  const arrow = { sourceSize: { w: 128, h: 128 } } as OsuStandardSkin["hitCircle"];
  const skin = { hitCircle: circle, hitCircleOverlay: circle, approachCircle: circle,
    comboColor: [1, 1, 1, 1], sliderBallFrames: [], reverseArrow: arrow } as unknown as OsuStandardSkin;
  const slider: OsuSlider = {
    kind: "slider", x: 100, y: 100, absolute_time: 1, hit_sound: 0, curve_type: "linear",
    control_points: [{ x: 200, y: 100 }], repeat_count: 2, pixel_length: 100,
    edge_sounds: [0, 0, 0], edge_sets: [{ normal_set: 0, addition_set: 0 },
      { normal_set: 0, addition_set: 0 }, { normal_set: 0, addition_set: 0 }],
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    span_duration: 0.5, total_duration: 1, end_time: 2, tick_distances: [],
  };
  const chart = { mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, overall_difficulty: 5,
    hp_drain_rate: 5, object_count: 1, drain_length_seconds: 1, end_time: 2, primary_tempo: 120,
    slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [], hit_objects: [slider] } as const;
  const path = OsuSliderPath.create(slider, 14);
  const quads: Parameters<Parameters<OsuPlayfieldRenderer["draw"]>[6]>[] = [];
  new OsuPlayfieldRenderer(skin).draw(new OsuViewport(640, 480), chart, new Uint8Array(1), 1, [], 1.25,
    (...quad) => quads.push(quad), () => path, () => undefined);
  const reverse = quads.at(-1)!;
  assert.equal(reverse[5], arrow);
  assert.ok(Math.abs(Math.abs(reverse[9]!) - Math.PI) < 1e-9);
});

test("draws only upcoming ticks for the current slider span", () => {
  const circle = { sourceSize: { w: 64, h: 64 } } as OsuStandardSkin["hitCircle"];
  const tick = { sourceSize: { w: 16, h: 17 } } as OsuStandardSkin["hitCircle"];
  const skin = { hitCircle: circle, hitCircleOverlay: circle, approachCircle: circle,
    comboColor: [1, 1, 1, 1], sliderBallFrames: [], sliderTick: tick } as unknown as OsuStandardSkin;
  const slider: OsuSlider = {
    kind: "slider", x: 100, y: 100, absolute_time: 1, hit_sound: 0, curve_type: "linear",
    control_points: [{ x: 300, y: 100 }], repeat_count: 1, pixel_length: 200,
    edge_sounds: [0, 0], edge_sets: [{ normal_set: 0, addition_set: 0 }, { normal_set: 0, addition_set: 0 }],
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    span_duration: 1, total_duration: 1, end_time: 2, tick_distances: [70, 140],
  };
  const chart = { mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, overall_difficulty: 5,
    hp_drain_rate: 5, object_count: 1, drain_length_seconds: 1, end_time: 2, primary_tempo: 120,
    slider_multiplier: 1.4, slider_tick_rate: 2, combo_colors: [], timing_points: [], hit_objects: [slider] } as const;
  const path = OsuSliderPath.create(slider, 14);
  const quads: Parameters<Parameters<OsuPlayfieldRenderer["draw"]>[6]>[] = [];
  new OsuPlayfieldRenderer(skin).draw(new OsuViewport(640, 480), chart, new Uint8Array(1), 1, [], 1.5,
    (...quad) => quads.push(quad), () => path, () => undefined);
  const ticks = quads.filter((quad) => quad[5] === tick);
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0]![0], 64 + 240 - 4);
});

test("uses beatmap combo colors and centers multi-digit object numbers", () => {
  const circle = { sourceSize: { w: 64, h: 64 } } as OsuStandardSkin["hitCircle"];
  const one = { sourceSize: { w: 20, h: 40 } } as OsuStandardSkin["hitCircle"];
  const two = { sourceSize: { w: 30, h: 40 } } as OsuStandardSkin["hitCircle"];
  const skin = { hitCircle: circle, hitCircleOverlay: circle, approachCircle: circle,
    comboColor: [1, 0, 0, 1], comboColors: [[1, 0, 0, 1]], hitCircleGlyphs: { "1": one, "2": two },
    hitCircleOverlap: -2 } as unknown as OsuStandardSkin;
  const object = { kind: "circle" as const, x: 256, y: 192, absolute_time: 1, hit_sound: 0,
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    new_combo: false, combo_skip: 0, combo_number: 12, combo_color_index: 1 };
  const chart = { mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, overall_difficulty: 5,
    hp_drain_rate: 5, object_count: 1, drain_length_seconds: 1, end_time: 1, primary_tempo: 120,
    slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [[0, 1, 0, 1], [0, 0, 1, 1]],
    timing_points: [], hit_objects: [object] } as const;
  const quads: Parameters<Parameters<OsuPlayfieldRenderer["draw"]>[6]>[] = [];
  new OsuPlayfieldRenderer(skin).draw(new OsuViewport(640, 480), chart, new Uint8Array(1), 0, [], 0.5,
    (...quad) => quads.push(quad));
  assert.deepEqual(quads[0]![4], [0, 0, 1, 1]);
  assert.equal(quads[1]![5], one);
  assert.equal(quads[2]![5], two);
  const number_width = quads[1]![2] + quads[2]![2] + 2 * (64 / 128 * 0.8);
  assert.ok(Math.abs(quads[1]![0] - (64 + 256 - number_width / 2)) < 1e-9);
});
