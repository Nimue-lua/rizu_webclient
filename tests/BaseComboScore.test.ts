import assert from "node:assert/strict";
import test from "node:test";
import { NoteState, type ManiaLogicEvent } from "../src/gameplay/ManiaLogicEvent";
import { ManiaComboScore } from "../src/gameplay/scoring/systems/ManiaComboScore";

function event(type: "tap" | "hold", old_state: NoteState, new_state: NoteState): ManiaLogicEvent {
  return { index: 0, type, time: 0, delta_time: 0, old_state, new_state };
}

test("increments tap and completed hold combo while preserving maximum", () => {
  const combo = new ManiaComboScore();
  combo.receive(event("tap", NoteState.Clear, NoteState.Passed));
  combo.receive(event("hold", NoteState.Clear, NoteState.StartPassedPressed));
  assert.equal(combo.getCombo(), 1);
  combo.receive(event("hold", NoteState.StartPassedPressed, NoteState.EndPassed));
  assert.equal(combo.getCombo(), 2);
  assert.equal(combo.getMaxCombo(), 2);
  combo.receive(event("tap", NoteState.Clear, NoteState.Missed));
  assert.equal(combo.getCombo(), 0);
  assert.equal(combo.getMaxCombo(), 2);
});

test("recovers combo at a successful hold tail after a missed head", () => {
  const combo = new ManiaComboScore();
  combo.receive(event("hold", NoteState.Clear, NoteState.StartMissed));
  combo.receive(event("hold", NoteState.StartMissed, NoteState.StartMissedPressed));
  combo.receive(event("hold", NoteState.StartMissedPressed, NoteState.EndMissedPassed));
  assert.equal(combo.getCombo(), 1);
});
