import type { GameplayData } from "../library/GameplayLoader";

const AUDIO_SCHEDULE_MARGIN = 0.1;
const FIRST_NOTE_LEAD_IN = 1.2;
const INTRO_SKIP_LEAD_IN = 1;
const RESULT_DELAY = 1.2;

export interface GameplayProgressRange {
  readonly introStart: number;
  readonly firstObject: number;
  readonly lastObject: number;
}

function firstPlayableTime(data: GameplayData): number {
  return data.mode === "mania"
    ? data.chart.notes.reduce((first, note) => note.weight >= 0 ? Math.min(first, note.absolute_time) : first, Infinity)
    : data.chart.hit_objects[0]?.absolute_time ?? Infinity;
}

export function getAudioStartDelay(data: GameplayData, music_rate: number, extra_lead_in = 0): number {
  const first_note_time = firstPlayableTime(data);
  if (!Number.isFinite(first_note_time)) return AUDIO_SCHEDULE_MARGIN;
  return Math.max(AUDIO_SCHEDULE_MARGIN, FIRST_NOTE_LEAD_IN + extra_lead_in - first_note_time / music_rate);
}

export function getIntroSkipTime(data: GameplayData, music_rate: number): number | null {
  const first_note_time = firstPlayableTime(data);
  return Number.isFinite(first_note_time) ? first_note_time - INTRO_SKIP_LEAD_IN * music_rate : null;
}

export function getGameplayProgressRange(data: GameplayData, music_rate: number): GameplayProgressRange | null {
  const first_object = firstPlayableTime(data);
  const last_object = data.mode === "mania"
    ? data.chart.notes.reduce((last, note) => Math.max(last, note.absolute_time), -Infinity)
    : data.chart.end_time;
  if (!Number.isFinite(first_object) || !Number.isFinite(last_object)) return null;
  return {
    introStart: -getAudioStartDelay(data, music_rate) * music_rate,
    firstObject: first_object,
    lastObject: Math.max(first_object, last_object),
  };
}

export function getGameplayProgress(song_time: number, range: GameplayProgressRange | null): number | null {
  if (!range) return null;
  if (song_time < range.firstObject) {
    const duration = range.firstObject - range.introStart;
    return duration <= 0 ? 0 : Math.max(-1, Math.min(0, (song_time - range.introStart) / duration - 1));
  }
  const duration = range.lastObject - range.firstObject;
  return duration <= 0 ? 1 : Math.max(0, Math.min(1, (song_time - range.firstObject) / duration));
}

export function getGameplayEndTime(data: GameplayData, music_rate: number): number {
  const last_note_time = data.mode === "mania"
    ? data.chart.notes.reduce((last, note) => Math.max(last, note.absolute_time), -Infinity)
    : data.chart.end_time;
  return last_note_time + RESULT_DELAY * music_rate;
}
