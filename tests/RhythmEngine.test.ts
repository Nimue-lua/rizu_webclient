import assert from "node:assert/strict";
import test from "node:test";
import { NoteState, RhythmEngine } from "../src/gameplay/RhythmEngine";

const chart = {
  column_count: 2,
  notes: [
    { column: 1, start_time: 1_000 },
    { column: 1, start_time: 1_500 },
    { column: 2, start_time: 2_000, end_time: 2_500 },
  ],
} as const;

test("judges presses at the early and late window boundaries", () => {
  const engine = new RhythmEngine(chart);
  engine.press(0, 840);
  engine.press(0, 1_600);
  assert.equal(engine.note_states[0], NoteState.Passed);
  assert.equal(engine.note_states[1], NoteState.Passed);
});

test("marks elapsed notes missed independently of rendering", () => {
  const engine = new RhythmEngine(chart);
  engine.update(1_101, 500, 500);
  assert.equal(engine.note_states[0], NoteState.Missed);
});

test("exposes format-neutral visual notes to the renderer", () => {
  const engine = new RhythmEngine(chart);
  engine.update(1_800, 1_000, 1_000);
  assert.deepEqual(engine.visible_notes.map(({ column, type, start_dt, end_dt }) => ({ column, type, start_dt, end_dt })), [
    { column: 2, type: "long", start_dt: 200, end_dt: 700 },
  ]);
});
