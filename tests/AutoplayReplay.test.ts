import assert from "node:assert/strict";
import test from "node:test";
import { createManiaAutoplayReplay, createOsuAutoplayReplay } from "../src/gameplay/AutoplayReplay";
import { replayTick } from "../src/replay/RecordedReplay";

const sample = { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" } as const;
const base = { hit_sound: 0, hit_sample: sample, new_combo: false, combo_skip: 0,
  combo_number: 1, combo_color_index: 0 } as const;

test("generates exact mania tap and hold replay input", () => {
  const replay = createManiaAutoplayReplay({ mode: "mania", column_count: 1, primary_tempo: 120,
    visual_points: [], notes: [
      { column: 1, absolute_time: 1, weight: 0 },
      { column: 1, absolute_time: 2, weight: 1 },
      { column: 1, absolute_time: 3, weight: -1 },
    ] }, false);

  assert.deepEqual(replay.input_events, [
    { time: replayTick(1), column: 0, pressed: true, note_index: 0, delta_time: 0 },
    { time: replayTick(1), column: 0, pressed: false, note_index: 0, delta_time: null },
    { time: replayTick(2), column: 0, pressed: true, note_index: 1, delta_time: 0 },
    { time: replayTick(3), column: 0, pressed: false, note_index: 1, delta_time: 0 },
  ]);
});

test("generates interpolated osu cursor travel between hit objects", () => {
  const replay = createOsuAutoplayReplay({ mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5,
    end_time: 2, hp_drain_rate: 5, object_count: 2, drain_length_seconds: 2, primary_tempo: 120,
    slider_multiplier: 1.4, slider_tick_rate: 1, sample_set: 0, combo_colors: [], timing_points: [], hit_objects: [
      { ...base, kind: "circle", x: 100, y: 100, absolute_time: 1 },
      { ...base, kind: "circle", x: 300, y: 200, absolute_time: 2 },
    ] });
  const aims = replay.input_events.filter((event) => event.type === "aim");

  assert.deepEqual(aims, [
    { type: "aim", time: replayTick(1), x: replayTick(100), y: replayTick(100) },
    { type: "aim", time: replayTick(2), x: replayTick(300), y: replayTick(200) },
  ]);
  // Replay playback interpolates these endpoints continuously at render time.
});
