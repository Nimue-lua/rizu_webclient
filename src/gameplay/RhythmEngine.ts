import type { Chart } from "../chart/Chart";

export const enum NoteState {
  Clear,
  Missed,
  Passed,
}

export interface VisualNote {
  index: number;
  column: number;
  state: NoteState;
  type: "short" | "long";
  start_dt: number;
  end_dt?: number;
}

const EARLY_HIT_WINDOW_MS = 160;
const LATE_HIT_WINDOW_MS = 100;

export class RhythmEngine {
  readonly note_states: Uint8Array;
  readonly visible_notes: VisualNote[] = [];
  private readonly chart: Chart;
  private readonly lane_notes: number[][];
  private readonly lane_cursors: Uint32Array;
  private miss_cursor = 0;

  constructor(chart: Chart) {
    this.chart = chart;
    this.note_states = new Uint8Array(chart.notes.length);
    this.lane_notes = Array.from({ length: chart.column_count }, () => []);
    this.lane_cursors = new Uint32Array(chart.column_count);
    chart.notes.forEach((note, index) => this.lane_notes[note.column - 1]?.push(index));
  }

  update(song_time: number, past_window: number, future_window: number): void {
    this.updateMisses(song_time);
    this.visible_notes.length = 0;
    for (let index = 0; index < this.chart.notes.length; index += 1) {
      const note = this.chart.notes[index]!;
      if (note.start_time < song_time - past_window) continue;
      if (note.start_time > song_time + future_window) break;
      const state = this.note_states[index] as NoteState;
      if (state !== NoteState.Clear) continue;
      this.visible_notes.push({
        index,
        column: note.column,
        state,
        type: note.end_time === undefined ? "short" : "long",
        start_dt: note.start_time - song_time,
        end_dt: note.end_time === undefined ? undefined : note.end_time - song_time,
      });
    }
  }

  press(column: number, song_time: number): void {
    this.updateMisses(song_time);
    const lane = this.lane_notes[column];
    if (!lane) return;
    let cursor = this.lane_cursors[column]!;
    while (cursor < lane.length && this.note_states[lane[cursor]!] !== NoteState.Clear) cursor += 1;
    this.lane_cursors[column] = cursor;
    const note_index = lane[cursor];
    if (note_index === undefined) return;
    const offset = song_time - this.chart.notes[note_index]!.start_time;
    if (offset >= -EARLY_HIT_WINDOW_MS && offset <= LATE_HIT_WINDOW_MS) {
      this.note_states[note_index] = NoteState.Passed;
      this.lane_cursors[column] = cursor + 1;
    }
  }

  private updateMisses(song_time: number): void {
    while (this.miss_cursor < this.chart.notes.length &&
      this.chart.notes[this.miss_cursor]!.start_time < song_time - LATE_HIT_WINDOW_MS) {
      if (this.note_states[this.miss_cursor] === NoteState.Clear) this.note_states[this.miss_cursor] = NoteState.Missed;
      this.miss_cursor += 1;
    }
  }
}
