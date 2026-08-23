import type { Chart, Note } from "../chart/Chart";
import { interpolateVisualPoint } from "../chart/VisualTimeline";

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

interface LinkedNote {
  start: Note;
  end?: Note;
}

const EARLY_HIT_WINDOW = 0.16;
const LATE_HIT_WINDOW = 0.1;
const TIME_EPSILON = 1e-9;

export class RhythmEngine {
  readonly note_states: Uint8Array;
  readonly visible_notes: VisualNote[] = [];
  private readonly chart: Chart;
  private readonly linked_notes: readonly LinkedNote[];
  private readonly lane_notes: number[][];
  private readonly lane_cursors: Uint32Array;
  private miss_cursor = 0;

  constructor(chart: Chart) {
    this.chart = chart;
    this.linked_notes = this.linkNotes(chart.notes);
    this.note_states = new Uint8Array(this.linked_notes.length);
    this.lane_notes = Array.from({ length: chart.column_count }, () => []);
    this.lane_cursors = new Uint32Array(chart.column_count);
    this.linked_notes.forEach((note, index) => this.lane_notes[note.start.column - 1]?.push(index));
  }

  update(song_time: number, past_window: number, future_window: number): void {
    this.updateMisses(song_time);
    this.visible_notes.length = 0;
    const current_point = interpolateVisualPoint(this.chart.visual_points, song_time);
    for (let index = 0; index < this.linked_notes.length; index += 1) {
      const note = this.linked_notes[index]!;
      const start_point = interpolateVisualPoint(this.chart.visual_points, note.start.absolute_time);
      const end_point = note.end && interpolateVisualPoint(this.chart.visual_points, note.end.absolute_time);
      const start_dt = (start_point.visual_time - current_point.visual_time) * current_point.global_speed * start_point.local_speed;
      const end_dt = end_point && (end_point.visual_time - current_point.visual_time) * current_point.global_speed * end_point.local_speed;
      if ((end_dt ?? start_dt) < -past_window) continue;
      if (start_dt > future_window) continue;
      const state = this.note_states[index] as NoteState;
      if (state !== NoteState.Clear) continue;
      this.visible_notes.push({
        index,
        column: note.start.column,
        state,
        type: note.end === undefined ? "short" : "long",
        start_dt,
        end_dt,
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
    const offset = song_time - this.linked_notes[note_index]!.start.absolute_time;
    if (offset >= -EARLY_HIT_WINDOW - TIME_EPSILON && offset <= LATE_HIT_WINDOW + TIME_EPSILON) {
      this.note_states[note_index] = NoteState.Passed;
      this.lane_cursors[column] = cursor + 1;
    }
  }

  private updateMisses(song_time: number): void {
    while (this.miss_cursor < this.linked_notes.length &&
      this.linked_notes[this.miss_cursor]!.start.absolute_time < song_time - LATE_HIT_WINDOW - TIME_EPSILON) {
      if (this.note_states[this.miss_cursor] === NoteState.Clear) this.note_states[this.miss_cursor] = NoteState.Missed;
      this.miss_cursor += 1;
    }
  }

  private linkNotes(notes: readonly Note[]): LinkedNote[] {
    const linked_notes: LinkedNote[] = [];
    const open_notes = Array.from({ length: this.chart.column_count }, () => [] as number[]);
    for (const note of notes) {
      if (note.weight === 0) {
        linked_notes.push({ start: note });
      } else if (note.weight === 1) {
        open_notes[note.column - 1]?.push(linked_notes.length);
        linked_notes.push({ start: note });
      } else {
        const linked_index = open_notes[note.column - 1]?.pop();
        if (linked_index === undefined) throw new Error(`Hold end in column ${note.column} has no start`);
        linked_notes[linked_index]!.end = note;
      }
    }
    if (open_notes.some((column) => column.length > 0)) throw new Error("Hold start has no end");
    linked_notes.sort((left, right) => left.start.absolute_time - right.start.absolute_time);
    return linked_notes;
  }
}
