import { createOsuManiaV2ReplayTimingValues } from "./OsuManiaV2Timings";
import { createOsuStandardTimingValues, type OsuStandardTimingValues } from "./OsuStandardOdTimings";
import { Subtimings } from "./Subtimings";
import { Timings } from "./Timings";
import { createSimpleTimingValues, type TimingValues } from "./TimingValues";

export interface ResolvedTimingValues {
  values: TimingValues;
  score_system: "osu_mania_v1" | "osu_mania_v2" | null;
}

export interface ResolvedOsuStandardTimingValues {
  values: OsuStandardTimingValues;
  score_system: "osu_standard_v1";
}

export function resolveOsuStandardTimingValues(timings: Timings,
  subtimings: Subtimings | null = null): ResolvedOsuStandardTimingValues {
  if (timings.name !== "osu_std_od" || subtimings !== null) throw new Error("invalid timings-subtimings pair");
  return { values: createOsuStandardTimingValues(timings.data), score_system: "osu_standard_v1" };
}

function createOsuManiaV1TimingValues(od: number): TimingValues {
  const od3 = Math.floor(od * 3);
  const meh = (151 - od3) / 1000;
  const miss = (188 - od3) / 1000;
  const ok = (127 - od3) / 1000;
  const window = (): { hit: [number, number]; miss: [number, number] } =>
    ({ hit: [-meh, ok], miss: [-miss, ok] });
  return { ShortNote: window(), LongNoteStart: window(), LongNoteEnd: window() };
}

export function resolveTimingValues(timings: Timings, subtimings: Subtimings | null): ResolvedTimingValues {
  if (timings.name === "arbitrary") throw new Error(subtimings ? "invalid timings-subtimings pair" : "undefined for arbitrary timings");
  if (timings.name === "osuod") {
    const score_version = subtimings === null ? 1 : subtimings.name === "scorev" ? subtimings.data : 0;
    if (score_version === 1) return { values: createOsuManiaV1TimingValues(timings.data), score_system: "osu_mania_v1" };
    if (score_version === 2) return { values: createOsuManiaV2ReplayTimingValues(timings.data), score_system: "osu_mania_v2" };
    throw new Error("invalid timings-subtimings pair");
  }
  if (timings.name === "osu_std_od") throw new Error("osu_std_od requires the osu standard timing resolver");
  if (subtimings !== null) throw new Error("invalid timings-subtimings pair");
  switch (timings.name) {
    case "sphere": return { values: createSimpleTimingValues(0.12, 0.16), score_system: null };
    case "simple": return { values: createSimpleTimingValues(timings.data), score_system: null };
    case "etternaj": return { values: createSimpleTimingValues(0.18), score_system: null };
    case "quaver": return { values: createSimpleTimingValues(0.127, 0.164), score_system: null };
    case "bmsrank": return { values: createSimpleTimingValues(0.2), score_system: null };
    case "unknown": return { values: createSimpleTimingValues(0), score_system: null };
  }
}
