import type { TimingWindow } from "./TimingValues";

export interface OsuManiaV2TimingValues {
  short_note: TimingWindow;
  long_note_start: TimingWindow;
  long_note_end: TimingWindow;
}

export function normalizeOsuOd(od: number): number {
  if (!Number.isFinite(od)) return 5;
  return Math.round(Math.min(Math.max(od, 0), 10) * 10) / 10;
}

export function createOsuManiaV2TimingValues(od: number): OsuManiaV2TimingValues {
  const normalized_od = normalizeOsuOd(od);
  const od3 = Math.floor(normalized_od * 3);
  const meh = (151 - od3) / 1000;
  const miss = (188 - od3) / 1000;
  const ok = (127 - od3) / 1000;
  const tail_meh = Math.floor((151 - od3) * 1.5) / 1000;
  const tail_miss = Math.floor((188 - od3) * 1.5) / 1000;
  const tail_ok = Math.floor((127 - od3) * 1.5) / 1000;
  return {
    short_note: { hit: [-meh, ok], miss: [-miss, ok] },
    long_note_start: { hit: [-meh, ok], miss: [-miss, ok] },
    long_note_end: { hit: [-tail_meh, tail_ok], miss: [-tail_miss, tail_ok] },
  };
}
