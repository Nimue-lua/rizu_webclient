import type { ScoreResult } from "../gameplay/scoring/ScoreResult";
import type { ManiaLogicEvent } from "../gameplay/mania/ManiaLogicEvent";
import type { OsuInputEvent } from "../gameplay/osu/OsuInputEvent";
import type { OsuStandardJudgmentEvent } from "../gameplay/osu/OsuStandardJudgmentEvent";
import type { ManiaReplayBaseValues } from "./mania/ManiaReplayBase";
import type { OsuReplayBaseValues } from "./osu/OsuReplayBase";

export const REPLAY_TICKS_PER_UNIT = 8192;

export function replayTick(value: number): number {
  return Math.round(value * REPLAY_TICKS_PER_UNIT);
}

export function replayValue(ticks: number): number {
  return ticks / REPLAY_TICKS_PER_UNIT;
}

export interface ManiaRecordedInputEvent {
  readonly time: number;
  readonly column: number;
  readonly pressed: boolean;
  readonly note_index: number | null;
  readonly delta_time: number | null;
}

interface RecordedReplayBase {
  readonly version: 1;
  readonly time_unit: "1/8192 second";
}

export interface ManiaRecordedReplay extends RecordedReplayBase {
  readonly mode: "mania";
  readonly input_events: readonly ManiaRecordedInputEvent[];
  readonly logic_events: readonly ManiaLogicEvent[];
}

export interface OsuRecordedReplay extends RecordedReplayBase {
  readonly mode: "osu";
  readonly input_events: readonly OsuInputEvent[];
  readonly judgment_events: readonly OsuStandardJudgmentEvent[];
}

export type RecordedReplay = ManiaRecordedReplay | OsuRecordedReplay;
export type RecordedReplayBaseValues = ManiaReplayBaseValues | OsuReplayBaseValues;

export interface CompletedGameplay {
  readonly score: ScoreResult;
  readonly replay_base: RecordedReplayBaseValues;
  readonly replay: RecordedReplay;
}
