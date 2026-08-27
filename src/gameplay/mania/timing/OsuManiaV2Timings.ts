import type { TimingValues, TimingWindow } from "../../timing/TimingValues";

export interface OsuManiaV2TimingValues {
  short_note: TimingWindow;
  long_note_start: TimingWindow;
  long_note_end: TimingWindow;
}

export interface OsuManiaV2TimingPreset extends OsuManiaV2TimingValues {
  overall_difficulty: number;
  head_judgments: readonly [number, number, number, number, number, number];
  tail_judgments: readonly [number, number, number, number, number, number];
}

export function normalizeOsuOd(od: number): number {
  if (!Number.isFinite(od)) return 5;
  return Math.round(Math.min(Math.max(od, 0), 10) * 10) / 10;
}

export function createOsuManiaV2TimingPreset(od: number): OsuManiaV2TimingPreset {
  const normalized_od = normalizeOsuOd(od);
  const od3 = Math.floor(normalized_od * 3);
  const perfect = Math.floor(normalized_od < 5 ? 22.4 - 0.6 * normalized_od : 24.9 - 1.1 * normalized_od);
  const base_windows = [perfect, 64 - od3, 97 - od3, 127 - od3, 151 - od3, 188 - od3] as const;
  const head_judgments = base_windows.map((window) => window / 1000) as unknown as OsuManiaV2TimingPreset["head_judgments"];
  const tail_judgments = base_windows.map((window) => Math.floor(window * 1.5) / 1000) as unknown as OsuManiaV2TimingPreset["tail_judgments"];
  return {
    overall_difficulty: normalized_od,
    head_judgments,
    tail_judgments,
    short_note: { hit: [-head_judgments[4], head_judgments[3]], miss: [-head_judgments[5], head_judgments[3]] },
    long_note_start: { hit: [-head_judgments[4], head_judgments[3]], miss: [-head_judgments[5], head_judgments[3]] },
    long_note_end: { hit: [-tail_judgments[4], tail_judgments[3]], miss: [-tail_judgments[5], tail_judgments[3]] },
  };
}

export function createOsuManiaV2TimingValues(od: number): OsuManiaV2TimingValues {
  return createOsuManiaV2TimingPreset(od);
}

export function createOsuManiaV2ReplayTimingValues(od: number): TimingValues {
  const values = createOsuManiaV2TimingPreset(od);
  return {
    ShortNote: values.short_note,
    LongNoteStart: values.long_note_start,
    LongNoteEnd: values.long_note_end,
  };
}
