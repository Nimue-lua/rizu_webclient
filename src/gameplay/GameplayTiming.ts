import type { GameplayData } from "../library/GameplayLoader";

const AUDIO_SCHEDULE_MARGIN = 0.1;
const FIRST_NOTE_LEAD_IN = 1.2;
const RESULT_DELAY = 1.2;

export function getAudioStartDelay(data: GameplayData, music_rate: number): number {
  const first_note_time = data.chart.mode === "mania"
    ? data.chart.notes.reduce((first, note) => note.weight >= 0 ? Math.min(first, note.absolute_time) : first, Infinity)
    : data.chart.circles[0]?.absolute_time ?? Infinity;
  if (!Number.isFinite(first_note_time)) return AUDIO_SCHEDULE_MARGIN;
  return Math.max(AUDIO_SCHEDULE_MARGIN, FIRST_NOTE_LEAD_IN - first_note_time / music_rate);
}

export function getGameplayEndTime(data: GameplayData, music_rate: number): number {
  const last_note_time = data.chart.mode === "mania"
    ? data.chart.notes.reduce((last, note) => Math.max(last, note.absolute_time), -Infinity)
    : data.chart.end_time;
  return last_note_time + RESULT_DELAY * music_rate;
}
