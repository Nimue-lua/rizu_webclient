import assert from "node:assert/strict";
import test from "node:test";
import { NoteState, RhythmEngine } from "../src/gameplay/RhythmEngine";

function createChart(notes: readonly { column: number; absolute_time: number; weight: -1 | 0 | 1 }[], columns = 1) {
  return {
    column_count: columns,
    overall_difficulty: 5,
    primary_tempo: 120,
    notes,
    visual_points: [
      { absolute_time: 0, visual_time: 0, current_speed: 1, local_speed: 1, global_speed: 1 },
    ],
  } as const;
}

function assertClose(actual: number | undefined, expected: number): void {
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
}

test("uses osu mania v2 head window boundaries", () => {
  const early = new RhythmEngine(createChart([{ column: 1, absolute_time: 1, weight: 0 }]));
  early.press(0, 0.864);
  assert.equal(early.note_states[0], NoteState.Passed);

  const late = new RhythmEngine(createChart([{ column: 1, absolute_time: 1, weight: 0 }]));
  late.press(0, 1.112);
  assert.equal(late.note_states[0], NoteState.Passed);

  const early_miss = new RhythmEngine(createChart([{ column: 1, absolute_time: 1, weight: 0 }]));
  early_miss.press(0, 0.83);
  assert.equal(early_miss.note_states[0], NoteState.Missed);
  assert.equal(early_miss.score.judges.miss, 1);
});

test("keeps too-early presses clear and emits the native no-op event", () => {
  const engine = new RhythmEngine(createChart([{ column: 1, absolute_time: 1, weight: 0 }]));
  assert.equal(engine.press(0, 0.8), 0);
  assert.equal(engine.note_states[0], NoteState.Clear);
  assert.equal(engine.logic_events.length, 1);
  assert.equal(engine.logic_events[0]?.new_state, NoteState.Clear);
  assert.equal(engine.score.judges.miss, 0);
});

test("marks elapsed notes missed and clamps the event to the timeout", () => {
  const engine = new RhythmEngine(createChart([{ column: 1, absolute_time: 1, weight: 0 }]));
  engine.update(2, 0.5, 0.5);
  assert.equal(engine.note_states[0], NoteState.Missed);
  assertClose(engine.logic_events[0]?.time, 1.112);
  assertClose(engine.logic_events[0]?.delta_time, 0.112);
  assert.equal(engine.score.judges.miss, 1);
});

test("holds stay active after the head and score their release", () => {
  const engine = new RhythmEngine(createChart([
    { column: 1, absolute_time: 1, weight: 1 },
    { column: 1, absolute_time: 2, weight: -1 },
  ]));
  const caught = engine.press(0, 1);
  assert.equal(caught, 0);
  assert.equal(engine.note_states[0], NoteState.StartPassedPressed);
  engine.update(1.5, 2, 2);
  assert.equal(engine.visible_notes.length, 1);
  assert.equal(engine.visible_notes[0]?.start_dt, 0);
  engine.release(caught!, 2);
  assert.equal(engine.note_states[0], NoteState.EndPassed);
  engine.update(2, 2, 2);
  assert.equal(engine.visible_notes.length, 0);
  assert.equal(engine.score.judges.perfect, 2);
  assert.equal(engine.score.accuracy, 1);
});

test("early release can be recovered and creates the native three judgments", () => {
  const engine = new RhythmEngine(createChart([
    { column: 1, absolute_time: 1, weight: 1 },
    { column: 1, absolute_time: 2, weight: -1 },
  ]));
  engine.press(0, 1);
  engine.release(0, 1.2);
  assert.equal(engine.note_states[0], NoteState.StartMissed);
  engine.press(0, 1.5);
  assert.equal(engine.note_states[0], NoteState.StartMissedPressed);
  engine.release(0, 2);
  assert.equal(engine.note_states[0], NoteState.EndMissedPassed);
  assert.equal(engine.score.judges.perfect, 2);
  assert.equal(engine.score.judges.miss, 1);
});

test("a missed hold head can be recovered for a successful tail", () => {
  const engine = new RhythmEngine(createChart([
    { column: 1, absolute_time: 1, weight: 1 },
    { column: 1, absolute_time: 2, weight: -1 },
  ]));
  engine.update(1.2, 2, 2);
  assert.equal(engine.note_states[0], NoteState.StartMissed);
  engine.press(0, 1.5);
  engine.release(0, 2);
  assert.equal(engine.note_states[0], NoteState.EndMissedPassed);
  assert.equal(engine.score.judges.perfect, 1);
  assert.equal(engine.score.judges.miss, 1);
});

test("a large time jump misses both hold endpoints", () => {
  const engine = new RhythmEngine(createChart([
    { column: 1, absolute_time: 1, weight: 1 },
    { column: 1, absolute_time: 2, weight: -1 },
  ]));
  engine.update(3, 2, 2);
  assert.equal(engine.note_states[0], NoteState.EndMissed);
  assert.deepEqual(engine.logic_events.map((event) => event.new_state), [NoteState.StartMissed, NoteState.EndMissed]);
  assert.equal(engine.score.judges.miss, 2);
  engine.update(2.5, 2, 2);
  assert.equal(engine.visible_notes.length, 1);
  assert.equal(engine.visible_notes[0]?.state, NoteState.EndMissed);
});

test("recovered missed holds do not use successful hold clamping", () => {
  const engine = new RhythmEngine(createChart([
    { column: 1, absolute_time: 1, weight: 1 },
    { column: 1, absolute_time: 2, weight: -1 },
  ]));
  engine.update(1.2, 2, 2);
  engine.press(0, 1.3);
  engine.update(1.5, 2, 2);
  assert.equal(engine.note_states[0], NoteState.StartMissedPressed);
  assertClose(engine.visible_notes[0]?.start_dt, -0.5);
});

test("earliest and nearest registration choose different overlapping notes", () => {
  const chart = createChart([
    { column: 1, absolute_time: 1, weight: 0 },
    { column: 1, absolute_time: 1.2, weight: 0 },
  ]);
  const earliest = new RhythmEngine(chart, "earliest");
  assert.equal(earliest.press(0, 1.11), 0);
  assert.equal(earliest.note_states[0], NoteState.Passed);

  const nearest = new RhythmEngine(chart, "nearest");
  assert.equal(nearest.press(0, 1.11), 1);
  assert.equal(nearest.note_states[1], NoteState.Passed);
});

test("nearest registration keeps encounter order on an exact tie", () => {
  const engine = new RhythmEngine(createChart([
    { column: 1, absolute_time: 1, weight: 0 },
    { column: 1, absolute_time: 1.2, weight: 0 },
  ]), "nearest");
  assert.equal(engine.press(0, 1.1), 0);
});

test("positions hold endpoints independently across scroll changes", () => {
  const engine = new RhythmEngine({
    ...createChart([
      { column: 1, absolute_time: 1, weight: 1 },
      { column: 1, absolute_time: 2, weight: -1 },
    ]),
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

test("keeps hit windows constant in real time at changed music rates", () => {
  const fast = new RhythmEngine(createChart([{ column: 1, absolute_time: 1, weight: 0 }]), "earliest", 2);
  fast.press(0, 1 + 0.112 * 2);
  assert.equal(fast.note_states[0], NoteState.Passed);
  assertClose(fast.logic_events[0]?.delta_time, 0.112);

  const slow = new RhythmEngine(createChart([{ column: 1, absolute_time: 1, weight: 0 }]), "earliest", 0.5);
  slow.press(0, 1 + 0.112 * 0.5);
  assert.equal(slow.note_states[0], NoteState.Passed);
  assertClose(slow.logic_events[0]?.delta_time, 0.112);
});

test("scales miss deadlines into chart time at changed music rates", () => {
  const engine = new RhythmEngine(createChart([{ column: 1, absolute_time: 1, weight: 0 }]), "earliest", 2);
  engine.update(1.2, 1, 1);
  assert.equal(engine.note_states[0], NoteState.Clear);
  engine.update(1.224 + 1e-6, 1, 1);
  assert.equal(engine.note_states[0], NoteState.Missed);
  assertClose(engine.logic_events[0]?.delta_time, 0.112);
});
