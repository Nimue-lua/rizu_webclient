import assert from "node:assert/strict";
import test from "node:test";
import { NoteState, RhythmEngine } from "../src/gameplay/RhythmEngine";

function assertClose(actual: number | undefined, expected: number): void {
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
}

const chart = {
  column_count: 2,
  primary_tempo: 120,
  notes: [
    { column: 1, absolute_time: 1, weight: 0 as const },
    { column: 1, absolute_time: 1.5, weight: 0 as const },
    { column: 2, absolute_time: 2, weight: 1 as const },
    { column: 2, absolute_time: 2.5, weight: -1 as const },
  ],
  visual_points: [
    { absolute_time: 0, visual_time: 0, current_speed: 1, local_speed: 1, global_speed: 1 },
  ],
} as const;

test("judges presses at the early and late window boundaries", () => {
  const engine = new RhythmEngine(chart);
  engine.press(0, 0.84);
  engine.press(0, 1.6);
  assert.equal(engine.note_states[0], NoteState.Passed);
  assert.equal(engine.note_states[1], NoteState.Passed);
});

test("positions hold endpoints independently across scroll changes", () => {
  const engine = new RhythmEngine({
    column_count: 1,
    primary_tempo: 120,
    notes: [
      { column: 1, absolute_time: 1, weight: 1 },
      { column: 1, absolute_time: 2, weight: -1 },
    ],
    visual_points: [
      { absolute_time: 0, visual_time: 0, current_speed: 1, local_speed: 1, global_speed: 1 },
      { absolute_time: 1.5, visual_time: 1.5, current_speed: 2, local_speed: 1, global_speed: 1 },
    ],
  });
  engine.update(1.09, 2, 2);
  assert.equal(engine.visible_notes.length, 1);
  assertClose(engine.visible_notes[0]?.start_dt, -0.09);
  assertClose(engine.visible_notes[0]?.end_dt, 1.41);
});

test("marks elapsed notes missed independently of rendering", () => {
  const engine = new RhythmEngine(chart);
  engine.update(1.101, 0.5, 0.5);
  assert.equal(engine.note_states[0], NoteState.Missed);
});

test("exposes format-neutral visual notes to the renderer", () => {
  const engine = new RhythmEngine(chart);
  engine.update(1.8, 1, 1);
  assert.equal(engine.visible_notes.length, 1);
  assert.equal(engine.visible_notes[0]?.column, 2);
  assert.equal(engine.visible_notes[0]?.type, "long");
  assertClose(engine.visible_notes[0]?.start_dt, 0.2);
  assertClose(engine.visible_notes[0]?.end_dt, 0.7);
});
