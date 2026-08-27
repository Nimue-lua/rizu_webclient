export const enum NoteState {
  Clear,
  Missed,
  Passed,
  StartMissed,
  EndMissed,
  StartMissedPressed,
  StartPassedPressed,
  EndPassed,
  EndMissedPassed,
}

export interface ManiaLogicEvent {
  index: number;
  type: "tap" | "hold";
  time: number;
  delta_time: number;
  old_state: NoteState;
  new_state: NoteState;
}
