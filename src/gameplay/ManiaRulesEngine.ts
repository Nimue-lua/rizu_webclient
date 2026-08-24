import type { ManiaChart, ManiaNoteEvent } from "../chart/Chart";
import { interpolateVisualPoint } from "../chart/VisualTimeline";
import { NoteState, type LogicEvent } from "./LogicEvent";
import { ScoreEngine } from "./scoring/ScoreEngine";
import type { ScoreResult } from "./scoring/ScoreResult";
import { BaseComboScore } from "./scoring/systems/BaseComboScore";
import { OsuManiaV2Score } from "./scoring/systems/OsuManiaV2Score";
import { createOsuManiaV2TimingValues } from "./timing/OsuManiaV2Timings";
import { classifyTiming, type TimingResult, type TimingWindow } from "./timing/TimingValues";

export { NoteState } from "./LogicEvent";

export type ManiaHitRegistration = "earliest" | "nearest";

export interface ManiaVisualNote {
  index: number;
  column: number;
  state: NoteState;
  type: "short" | "long";
  start_dt: number;
  end_dt?: number;
}

interface LinkedNote {
  start: ManiaNoteEvent;
  end?: ManiaNoteEvent;
}

const TIME_EPSILON = 1e-9;

function isActive(state: NoteState, hold: boolean): boolean {
  if (!hold) return state === NoteState.Clear;
  return state === NoteState.Clear || state === NoteState.StartMissed ||
    state === NoteState.StartMissedPressed || state === NoteState.StartPassedPressed;
}

export class ManiaRulesEngine {
  readonly note_states: Uint8Array;
  readonly visible_notes: ManiaVisualNote[] = [];
  readonly logic_events: LogicEvent[] = [];
  private readonly chart: ManiaChart;
  private readonly linked_notes: readonly LinkedNote[];
  private readonly lane_notes: number[][];
  private readonly timings;
  private readonly score_engine: ScoreEngine;
  private readonly hit_registration: ManiaHitRegistration;
  private readonly music_rate: number;
  private readonly constant_scroll: boolean;
  private readonly head_press_times: Float64Array;
  private readonly head_release_times: Float64Array;

  constructor(chart: ManiaChart, hit_registration: ManiaHitRegistration = "earliest", music_rate = 1,
    constant_scroll = false, tap_only = false) {
    this.chart = chart;
    this.linked_notes = this.linkNotes(chart.notes, tap_only);
    this.note_states = new Uint8Array(this.linked_notes.length);
    this.head_press_times = new Float64Array(this.linked_notes.length).fill(Number.NaN);
    this.head_release_times = new Float64Array(this.linked_notes.length).fill(Number.NaN);
    this.lane_notes = Array.from({ length: chart.column_count }, () => []);
    this.linked_notes.forEach((note, index) => this.lane_notes[note.start.column - 1]?.push(index));
    this.timings = createOsuManiaV2TimingValues(chart.overall_difficulty ?? 5);
    this.score_engine = new ScoreEngine([new BaseComboScore(), new OsuManiaV2Score(chart.overall_difficulty ?? 5)]);
    this.hit_registration = hit_registration;
    this.music_rate = music_rate;
    this.constant_scroll = constant_scroll;
  }

  get score(): ScoreResult {
    return this.score_engine.getResult();
  }

  update(song_time: number, past_window: number, future_window: number): void {
    this.updateMisses(song_time);
    this.visible_notes.length = 0;
    const current_point = this.constant_scroll ? undefined : interpolateVisualPoint(this.chart.visual_points, song_time);
    for (let index = 0; index < this.linked_notes.length; index += 1) {
      const note = this.linked_notes[index]!;
      const state = this.note_states[index] as NoteState;
      if (note.end === undefined && !isActive(state, false)) continue;
      let start_time = note.start.absolute_time;
      if (note.end && (state === NoteState.StartPassedPressed || state === NoteState.EndPassed)) {
        const press_time = this.head_press_times[index];
        const press_delay = Math.max((Number.isNaN(press_time) ? song_time : press_time) - start_time, 0);
        const elapsed = song_time - (Number.isNaN(press_time) ? song_time : press_time);
        start_time = Math.min(note.end.absolute_time,
          Math.max(start_time, song_time + Math.min(elapsed - press_delay, 0)));
      } else if (state === NoteState.StartMissed || state === NoteState.EndMissed) {
        const release_time = this.head_release_times[index];
        if (!Number.isNaN(release_time)) start_time = release_time;
      }
      const getDt = (absolute_time: number): number => {
        if (!current_point) return absolute_time - song_time;
        const point = interpolateVisualPoint(this.chart.visual_points, absolute_time);
        return (point.visual_time - current_point.visual_time) * current_point.global_speed * point.local_speed;
      };
      const start_dt = getDt(start_time);
      const end_dt = note.end && getDt(note.end.absolute_time);
      if ((end_dt ?? start_dt) < -past_window || start_dt > future_window) continue;
      if (end_dt !== undefined && start_dt >= end_dt) continue;
      this.visible_notes.push({
        index, column: note.start.column, state, type: note.end === undefined ? "short" : "long", start_dt, end_dt,
      });
    }
  }

  press(column: number, song_time: number): number | undefined {
    this.updateMisses(song_time);
    const candidates = this.getCandidates(column, song_time);
    if (candidates.length === 0) return undefined;
    const maximum_priority = Math.max(...candidates.map((index) => this.note_states[index] === NoteState.Clear ? 0 : -1));
    const prioritized = candidates.filter((index) => (this.note_states[index] === NoteState.Clear ? 0 : -1) === maximum_priority);
    let note_index = prioritized[0]!;
    if (this.hit_registration === "nearest") {
      let nearest_time = Math.abs(song_time - this.linked_notes[note_index]!.start.absolute_time);
      for (const index of prioritized.slice(1)) {
        const distance = Math.abs(song_time - this.linked_notes[index]!.start.absolute_time);
        if (distance < nearest_time - TIME_EPSILON) {
          note_index = index;
          nearest_time = distance;
        }
      }
    }
    this.input(note_index, true, song_time);
    return note_index;
  }

  release(note_index: number, song_time: number): void {
    this.updateMisses(song_time);
    if (note_index >= 0 && note_index < this.linked_notes.length) this.input(note_index, false, song_time);
  }

  private getCandidates(column: number, song_time: number): number[] {
    const lane = this.lane_notes[column];
    if (!lane) return [];
    const candidates: number[] = [];
    let included_future_note = false;
    for (const index of lane) {
      const note = this.linked_notes[index]!;
      if (!isActive(this.note_states[index] as NoteState, note.end !== undefined)) continue;
      const minimum = note.start.absolute_time + this.timings.long_note_start.miss[0] * this.music_rate;
      if (minimum > song_time + TIME_EPSILON) {
        if (!included_future_note) candidates.push(index);
        included_future_note = true;
        break;
      }
      candidates.push(index);
    }
    return candidates;
  }

  private input(index: number, pressed: boolean, song_time: number): void {
    const note = this.linked_notes[index]!;
    const state = this.note_states[index] as NoteState;
    if (!note.end) {
      if (!pressed || state !== NoteState.Clear) return;
      const result = classifyTiming(this.timings.short_note, (song_time - note.start.absolute_time) / this.music_rate);
      if (result === "too early") this.switchState(index, NoteState.Clear, song_time, this.timings.short_note, note.start.absolute_time);
      else if (result === "early" || result === "late") this.switchState(index, NoteState.Missed, song_time, this.timings.short_note, note.start.absolute_time);
      else if (result === "exactly") this.switchState(index, NoteState.Passed, song_time, this.timings.short_note, note.start.absolute_time);
      return;
    }

    const start_result = classifyTiming(this.timings.long_note_start, (song_time - note.start.absolute_time) / this.music_rate);
    const end_result = classifyTiming(this.timings.long_note_end, (song_time - note.end.absolute_time) / this.music_rate);
    if (pressed) {
      if (state === NoteState.Clear) {
        if (start_result === "too early") this.switchState(index, NoteState.Clear, song_time, this.timings.long_note_start, note.start.absolute_time);
        else if (start_result === "early" || start_result === "late") this.switchState(index, NoteState.StartMissedPressed, song_time, this.timings.long_note_start, note.start.absolute_time);
        else if (start_result === "exactly") this.switchState(index, NoteState.StartPassedPressed, song_time, this.timings.long_note_start, note.start.absolute_time);
      } else if (state === NoteState.StartMissed) {
        this.switchState(index, NoteState.StartMissedPressed, song_time, this.timings.long_note_end, note.end.absolute_time);
      }
    } else if (state === NoteState.StartPassedPressed) {
      this.releaseHold(index, end_result, false, song_time);
    } else if (state === NoteState.StartMissedPressed) {
      this.releaseHold(index, end_result, true, song_time);
    }
  }

  private releaseHold(index: number, result: TimingResult, missed_start: boolean, song_time: number): void {
    const note = this.linked_notes[index]!;
    if (result === "too early") this.switchState(index, NoteState.StartMissed, song_time, this.timings.long_note_end, note.end!.absolute_time);
    else if (result === "early" || result === "late") this.switchState(index, NoteState.EndMissed, song_time, this.timings.long_note_end, note.end!.absolute_time);
    else if (result === "exactly") this.switchState(index, missed_start ? NoteState.EndMissedPassed : NoteState.EndPassed,
      song_time, this.timings.long_note_end, note.end!.absolute_time);
  }

  private updateMisses(song_time: number): void {
    for (let index = 0; index < this.linked_notes.length; index += 1) {
      const note = this.linked_notes[index]!;
      let state = this.note_states[index] as NoteState;
      if (!isActive(state, note.end !== undefined)) continue;
      const start_window = note.end ? this.timings.long_note_start : this.timings.short_note;
      if (state === NoteState.Clear && song_time > note.start.absolute_time + start_window.miss[1] * this.music_rate + TIME_EPSILON) {
        this.switchState(index, note.end ? NoteState.StartMissed : NoteState.Missed, song_time, start_window, note.start.absolute_time);
        state = this.note_states[index] as NoteState;
      }
      if (note.end && isActive(state, true) && song_time > note.end.absolute_time + this.timings.long_note_end.miss[1] * this.music_rate + TIME_EPSILON) {
        this.switchState(index, NoteState.EndMissed, song_time, this.timings.long_note_end, note.end.absolute_time);
      }
    }
  }

  private switchState(index: number, new_state: NoteState, song_time: number, window: TimingWindow, target_time: number): void {
    const old_state = this.note_states[index] as NoteState;
    if (new_state === NoteState.StartPassedPressed) this.head_press_times[index] = song_time;
    if (old_state === NoteState.StartPassedPressed &&
      (new_state === NoteState.StartMissed || new_state === NoteState.EndMissed)) {
      this.head_release_times[index] = song_time;
    } else if (new_state === NoteState.StartMissedPressed) {
      this.head_release_times[index] = Number.NaN;
    }
    this.note_states[index] = new_state;
    const event: LogicEvent = {
      index,
      type: this.linked_notes[index]!.end ? "hold" : "tap",
      time: Math.min(song_time, target_time + window.miss[1] * this.music_rate),
      delta_time: Math.min((song_time - target_time) / this.music_rate, window.miss[1]),
      old_state,
      new_state,
    };
    this.logic_events.push(event);
    this.score_engine.receive(event);
  }

  private linkNotes(notes: readonly ManiaNoteEvent[], tap_only: boolean): LinkedNote[] {
    const linked_notes: LinkedNote[] = [];
    const open_notes = Array.from({ length: this.chart.column_count }, () => [] as number[]);
    for (const note of notes) {
      if (note.weight === 0) linked_notes.push({ start: note });
      else if (note.weight === 1) {
        open_notes[note.column - 1]?.push(linked_notes.length);
        linked_notes.push({ start: note });
      } else {
        const linked_index = open_notes[note.column - 1]?.pop();
        if (linked_index === undefined) throw new Error(`Hold end in column ${note.column} has no start`);
        linked_notes[linked_index]!.end = note;
      }
    }
    if (open_notes.some((column) => column.length > 0)) throw new Error("Hold start has no end");
    if (tap_only) {
      for (const note of linked_notes) delete note.end;
    }
    linked_notes.sort((left, right) => left.start.absolute_time - right.start.absolute_time);
    return linked_notes;
  }
}
