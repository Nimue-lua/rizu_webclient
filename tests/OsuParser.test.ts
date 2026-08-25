import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseOsuChart } from "../src/chart/format/osu/OsuParser";

function roundedTime(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}

test("normalizes osu mania notes into chronological chart notes", () => {
  const chart = parseOsuChart(`
[Difficulty]
CircleSize:4
[TimingPoints]
0,500,4,2,0,100,1,0
150,-50,4,2,0,100,0,0
[HitObjects]
448,192,200,1,0,0:0:0:0:
64,192,100,128,0,250:0:0:0:0:
`);

  assert.deepEqual(chart, {
    mode: "mania",
    column_count: 4,
    overall_difficulty: 5,
    primary_tempo: 120,
    notes: [
      { column: 1, absolute_time: 0.1, weight: 1 },
      { column: 4, absolute_time: 0.2, weight: 0 },
      { column: 1, absolute_time: 0.25, weight: -1 },
    ],
    visual_points: [
      { absolute_time: 0, visual_time: 0, current_speed: 1, local_speed: 1, global_speed: 1 },
      { absolute_time: 0.15, visual_time: 0.15, current_speed: 2, local_speed: 1, global_speed: 1 },
    ],
  });
});

test("retains typed standard objects, slider data, and normalized durations", () => {
  const source = readFileSync(new URL("fixtures/osu/standard-objects.osu", import.meta.url), "utf8");
  const chart = parseOsuChart(source);
  assert.equal(chart.mode, "osu");
  if (chart.mode !== "osu") return;

  assert.equal(chart.slider_multiplier, 2);
  assert.equal(chart.end_time, 3.6);
  assert.equal(chart.object_count, 6);
  assert.equal(chart.drain_length_seconds, 3);
  assert.deepEqual(chart.timing_points, [
    { absolute_time: 0, beat_length: 0.5, uninherited: true, slider_velocity: 1 },
    { absolute_time: 1, beat_length: -0.05, uninherited: false, slider_velocity: 2 },
    { absolute_time: 2, beat_length: 0.4, uninherited: true, slider_velocity: 1 },
  ]);
  assert.deepEqual(chart.hit_objects.map((object) => object.kind),
    ["circle", "slider", "slider", "slider", "slider", "spinner"]);

  const circle = chart.hit_objects[0]!;
  assert.deepEqual(circle, {
    kind: "circle", x: 64, y: 64, absolute_time: 0.5, hit_sound: 2,
    hit_sample: { normal_set: 1, addition_set: 2, index: 3, volume: 40, filename: "circle.wav" },
  });
  const sliders = chart.hit_objects.filter((object) => object.kind === "slider");
  assert.deepEqual(sliders.map((slider) => slider.curve_type), ["linear", "bezier", "perfect", "catmull"]);
  assert.deepEqual(sliders[0], {
    kind: "slider", x: 100, y: 100, absolute_time: 1, hit_sound: 4,
    curve_type: "linear", control_points: [{ x: 200, y: 100 }], repeat_count: 2, pixel_length: 200,
    edge_sounds: [2, 8, 4],
    edge_sets: [{ normal_set: 1, addition_set: 2 }, { normal_set: 2, addition_set: 3 },
      { normal_set: 3, addition_set: 1 }],
    hit_sample: { normal_set: 2, addition_set: 3, index: 4, volume: 60, filename: "slider.wav" },
    span_duration: 0.25, total_duration: 0.5, end_time: 1.5,
  });
  assert.ok(Math.abs((sliders[2]?.span_duration ?? 0) - 0.2) < 1e-12);
  assert.equal(sliders[3]?.end_time, 2.7);
  assert.deepEqual(chart.hit_objects[5], {
    kind: "spinner", x: 256, y: 192, absolute_time: 3, hit_sound: 0, end_time: 3.6,
    hit_sample: { normal_set: 3, addition_set: 1, index: 2, volume: 70, filename: "spinner.wav" },
  });
});

test("uses the active red point and inherited SV and floors stable slider end time", () => {
  const chart = parseOsuChart(`
[General]
Mode:0
[Difficulty]
CircleSize:4
SliderMultiplier:1.4
[TimingPoints]
0,500,4,2,0,100,1,0
1000,-80,4,2,0,100,0,0
1500,250,4,2,0,100,1,0
[HitObjects]
64,64,1250,2,0,L|164:64,3,101
64,64,1600,2,0,L|164:64,1,100
64,64,1700,1,0,0:0:0:0:
`);
  assert.equal(chart.mode, "osu");
  if (chart.mode !== "osu") return;
  const [first, second] = chart.hit_objects.filter((object) => object.kind === "slider");
  assert.equal(first?.end_time, 2.115);
  assert.ok(Math.abs((first?.span_duration ?? 0) - 0.28833333333333333) < 1e-12);
  assert.equal(second?.end_time, 1.778);
  assert.equal(chart.end_time, 2.115);
});

test("preserves source order for same-time standard objects", () => {
  const chart = parseOsuChart(`
[General]
Mode:0
[Difficulty]
CircleSize:4
[HitObjects]
300,100,1000,1,0,0:0:0:0:
100,100,1000,8,0,1200,0:0:0:0:
200,100,1000,1,0,0:0:0:0:
`);
  assert.equal(chart.mode, "osu");
  if (chart.mode === "osu") assert.deepEqual(chart.hit_objects.map((object) => object.x), [300, 100, 200]);
});

test("rejects malformed standard sliders and spinners", () => {
  const prefix = `[General]\nMode:0\n[Difficulty]\nCircleSize:4\n[HitObjects]\n`;
  assert.throws(() => parseOsuChart(`${prefix}64,64,1000,2,0,Q|100:100,1,100`), /Invalid slider path/);
  assert.throws(() => parseOsuChart(`${prefix}64,64,1000,2,0,L|bad:100,1,100`), /Invalid slider path/);
  assert.throws(() => parseOsuChart(`${prefix}64,64,1000,2,0,L|100:100,0,100`), /Invalid slider/);
  assert.throws(() => parseOsuChart(`${prefix}64,64,1000,8,0,999`), /Invalid spinner/);
});

test("uses overall difficulty as approach rate for old osu charts", () => {
  const chart = parseOsuChart(`
[General]
Mode:0
[Difficulty]
CircleSize:5
OverallDifficulty:7
`);
  assert.equal(chart.mode, "osu");
  if (chart.mode === "osu") assert.equal(chart.approach_rate, 7);
});

test("parses overall difficulty for gameplay timings", () => {
  const chart = parseOsuChart(`
[Difficulty]
CircleSize:4
OverallDifficulty:7.5
[HitObjects]
64,192,100,1,0,0:0:0:0:
`);
  assert.equal(chart.overall_difficulty, 7.5);
});

test("retains stable standard scoring metadata and subtracts breaks from drain length", () => {
  const chart = parseOsuChart(`
[General]
Mode:0
[Difficulty]
CircleSize:4
HPDrainRate:7
OverallDifficulty:6
[Events]
2,3000,5000
[HitObjects]
64,192,1000,1,0,0:0:0:0:
64,192,10000,1,0,0:0:0:0:
`);
  assert.equal(chart.mode, "osu");
  if (chart.mode === "osu") {
    assert.equal(chart.hp_drain_rate, 7);
    assert.equal(chart.object_count, 2);
    assert.equal(chart.drain_length_seconds, 7);
  }
});

test("resets scroll velocity at BPM timing points", () => {
  const chart = parseOsuChart(`
[Difficulty]
CircleSize:4
[TimingPoints]
0,500,4,2,0,100,1,0
100,-50,4,2,0,100,0,0
200,250,4,2,0,100,1,0
[HitObjects]
64,192,300,1,0,0:0:0:0:
`);
  assert.deepEqual(chart.visual_points.map(({ absolute_time, visual_time, current_speed }) => ({ absolute_time, visual_time: roundedTime(visual_time), current_speed })), [
    { absolute_time: 0, visual_time: 0, current_speed: 1 },
    { absolute_time: 0.1, visual_time: 0.1, current_speed: 2 },
    { absolute_time: 0.2, visual_time: 0.3, current_speed: 2 },
  ]);
});

test("keeps explicit scroll velocity at a BPM point regardless of line order", () => {
  const chart = parseOsuChart(`
[Difficulty]
CircleSize:4
[TimingPoints]
0,-50,4,2,0,100,0,0
0,500,4,2,0,100,1,0
[HitObjects]
64,192,100,1,0,0:0:0:0:
`);
  assert.equal(chart.visual_points[0]?.current_speed, 2);
});

test("applies the normalized first timing point speed before its timestamp", () => {
  const chart = parseOsuChart(`
[Difficulty]
CircleSize:4
[TimingPoints]
500,250,4,2,0,100,1,0
[HitObjects]
64,192,250,1,0,0:0:0:0:
`);
  assert.deepEqual(chart.visual_points.map(({ absolute_time, visual_time, current_speed }) => ({ absolute_time, visual_time, current_speed })), [
    { absolute_time: 0, visual_time: 0, current_speed: 1 },
    { absolute_time: 0.5, visual_time: 0.5, current_speed: 1 },
  ]);
  assert.equal(chart.primary_tempo, 240);
});

test("uses the BPM active for the longest duration as primary tempo", () => {
  const chart = parseOsuChart(`
[General]
Mode:3
[Difficulty]
CircleSize:4
[TimingPoints]
0,333.3333333333333,4,2,0,100,1,0
2000,500,4,2,0,100,1,0
[HitObjects]
64,192,3000,1,0,0:0:0:0:
`);
  assert.ok(Math.abs(chart.primary_tempo - 180) < 1e-12);
  assert.ok(Math.abs(chart.visual_points[0]!.current_speed - 1) < 1e-12);
  assert.ok(Math.abs(chart.visual_points[1]!.current_speed - 2 / 3) < 1e-12);
});

test("rejects a hold note ending before it starts", () => {
  assert.throws(() => parseOsuChart(`
[Difficulty]
CircleSize:4
[HitObjects]
64,192,200,128,0,100:0:0:0:0:
`), /Invalid hold note/);
});
