import type { PlayRequest } from "../gameplay/GameplayController";
import type { ScoreResult } from "../gameplay/scoring/ScoreResult";
import type { CompletedGameplay } from "../replay/RecordedReplay";

export interface DanChartIdentity {
  readonly chart_md5: string;
  readonly chart_index: number;
}

export interface DanCourseDefinition {
  readonly id: string;
  readonly name: string;
  readonly goal_accuracy: number;
  readonly mode: "osu" | "mania";
  readonly charts: readonly DanChartIdentity[];
}

export interface ResolvedDanCourse extends DanCourseDefinition {
  readonly stages: readonly PlayRequest[];
}

export interface DanCourseResult {
  readonly course: ResolvedDanCourse;
  readonly stages: readonly CompletedGameplay[];
  readonly accuracy: number;
  readonly cleared: boolean;
}

export type DanStatus = "idle" | "preparing" | "playing" | "break" | "completed";

export interface DanController {
  readonly status: DanStatus;
  readonly course: ResolvedDanCourse | null;
  readonly stage_index: number;
  readonly completed_stages: readonly CompletedGameplay[];
  readonly result: DanCourseResult | null;
  begin(course: ResolvedDanCourse): Promise<void>;
  continue(): void;
  discard(): void;
}

export function danAccuracy(scores: readonly ScoreResult[], mode: DanCourseDefinition["mode"] = "mania"): number {
  let earned = 0;
  let possible = 0;
  for (const score of scores) {
    const judges = score.judges;
    if (!judges) continue;
    const weights: Readonly<Record<string, number>> = mode === "mania" ? {
      perfect: 305, great: 300, good: 200, ok: 100, meh: 50, miss: 0,
    } : { "300": 300, "100": 100, "50": 50, miss: 0 };
    const maximum = mode === "mania" ? 305 : 300;
    for (const [judge, count] of Object.entries(judges)) {
      const weight = weights[judge];
      if (weight === undefined) continue;
      earned += weight * count;
      possible += maximum * count;
    }
  }
  return possible === 0 ? 0 : earned / possible;
}
