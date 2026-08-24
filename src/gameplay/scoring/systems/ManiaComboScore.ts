import { NoteState, type ManiaLogicEvent } from "../../ManiaLogicEvent";
import type { IComboSource } from "../ScoreSources";
import type { ScoreSystem } from "../ScoreSystem";

export class ManiaComboScore implements ScoreSystem<ManiaLogicEvent>, IComboSource {
  readonly key = "mania_combo";
  private combo = 0;
  private max_combo = 0;

  receive(event: ManiaLogicEvent): void {
    if (event.type === "tap") {
      if (event.old_state === NoteState.Clear && event.new_state === NoteState.Passed) this.increment();
      else if (event.old_state === NoteState.Clear && event.new_state === NoteState.Missed) this.break();
      return;
    }

    if (event.old_state === NoteState.Clear &&
      (event.new_state === NoteState.StartMissed || event.new_state === NoteState.StartMissedPressed)) {
      this.break();
    } else if (event.old_state === NoteState.StartPassedPressed) {
      if (event.new_state === NoteState.EndPassed) this.increment();
      else if (event.new_state === NoteState.StartMissed || event.new_state === NoteState.EndMissed) this.break();
    } else if (event.old_state === NoteState.StartMissedPressed) {
      if (event.new_state === NoteState.EndMissedPassed) this.increment();
      else if (event.new_state === NoteState.StartMissed || event.new_state === NoteState.EndMissed) this.break();
    } else if (event.old_state === NoteState.StartMissed && event.new_state === NoteState.EndMissed) {
      this.break();
    }
  }

  getCombo(): number {
    return this.combo;
  }

  getMaxCombo(): number {
    return this.max_combo;
  }

  private increment(): void {
    this.combo += 1;
    this.max_combo = Math.max(this.max_combo, this.combo);
  }

  private break(): void {
    this.combo = 0;
  }
}
