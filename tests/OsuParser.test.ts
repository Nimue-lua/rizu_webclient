import assert from "node:assert/strict";
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

test("parses osu circles and ignores sliders and spinners", () => {
  const chart = parseOsuChart(`
[General]
Mode:0
[Difficulty]
CircleSize:4.2
OverallDifficulty:6
ApproachRate:8
[HitObjects]
400,300,1500,1,0,0:0:0:0:
100,200,500,2,0,B|200:200,1,100
256,192,1000,5,0,0:0:0:0:
256,192,2000,8,0,2500
`);

  assert.deepEqual(chart, {
    mode: "osu",
    approach_rate: 8,
    circle_size: 4.2,
    end_time: 2,
    overall_difficulty: 6,
    primary_tempo: 120,
    circles: [
      { x: 256, y: 192, absolute_time: 1 },
      { x: 400, y: 300, absolute_time: 1.5 },
    ],
  });
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
