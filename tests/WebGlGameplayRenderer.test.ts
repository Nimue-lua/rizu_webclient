import assert from "node:assert/strict";
import test from "node:test";
import { NoteState } from "../src/gameplay/LogicEvent";
import { getLongNoteBrightness } from "../src/gameplay/renderer/WebGlGameplayRenderer";

test("dims long notes according to native hold states", () => {
  assert.equal(getLongNoteBrightness(NoteState.Clear), 1);
  assert.equal(getLongNoteBrightness(NoteState.StartPassedPressed), 1);
  assert.equal(getLongNoteBrightness(NoteState.StartMissed), 0.5);
  assert.equal(getLongNoteBrightness(NoteState.StartMissedPressed), 0.75);
  assert.equal(getLongNoteBrightness(NoteState.EndMissed), 0.5);
  assert.equal(getLongNoteBrightness(NoteState.EndMissedPassed), 0.5);
  assert.equal(getLongNoteBrightness(NoteState.EndPassed), 1);
});
