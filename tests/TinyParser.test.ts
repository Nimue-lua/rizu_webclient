import assert from "node:assert/strict";
import test from "node:test";
import { parseOsuChart } from "../src/chart/format/osu/TinyParser";

test("normalizes osu mania notes into chronological chart notes", () => {
  const chart = parseOsuChart(`
[Difficulty]
CircleSize:4
[HitObjects]
448,192,200,1,0,0:0:0:0:
64,192,100,128,0,250:0:0:0:0:
`);

  assert.deepEqual(chart, {
    column_count: 4,
    notes: [
      { column: 1, start_time: 100, end_time: 250 },
      { column: 4, start_time: 200 },
    ],
  });
});

test("rejects a hold note ending before it starts", () => {
  assert.throws(() => parseOsuChart(`
[Difficulty]
CircleSize:4
[HitObjects]
64,192,200,128,0,100:0:0:0:0:
`), /Invalid hold note/);
});
