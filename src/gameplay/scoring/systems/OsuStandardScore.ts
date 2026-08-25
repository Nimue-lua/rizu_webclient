import type { OsuStandardJudgmentEvent } from "../../OsuStandardJudgmentEvent";
import type { OsuStandardTimingValues } from "../../timing/OsuStandardOdTimings";
import type { IAccuracySource, IComboSource, IGradeSource, IJudgesSource, IScoreSource } from "../ScoreSources";
import type { ScoreSystem } from "../ScoreSystem";

export const OSU_STANDARD_JUDGE_NAMES = ["300", "100", "50", "miss"] as const;
export type OsuStandardJudge = typeof OSU_STANDARD_JUDGE_NAMES[number];
export type OsuStandardGrade = "X" | "S" | "A" | "B" | "C" | "D";

const BASE_SCORES = [300, 100, 50, 0] as const;

export function classifyOsuStandardJudgment(windows: OsuStandardTimingValues,
  event: OsuStandardJudgmentEvent): OsuStandardJudge {
  if (event.kind === "miss") return "miss";
  const delta = Math.abs(event.delta_time);
  if (delta < windows.hit_300) return "300";
  if (delta < windows.hit_100) return "100";
  if (delta < windows.hit_50) return "50";
  return "miss";
}

export class OsuStandardScore implements ScoreSystem<OsuStandardJudgmentEvent>, IScoreSource,
  IAccuracySource, IGradeSource, IComboSource, IJudgesSource {
  readonly key = "osu_standard_v1";
  readonly judge_names = OSU_STANDARD_JUDGE_NAMES;
  private readonly judge_counts = OSU_STANDARD_JUDGE_NAMES.map(() => 0);
  private readonly difficulty_multiplier: number;
  private score = 0;
  private combo = 0;
  private max_combo = 0;
  private last_judge_index: number | null = null;

  constructor(private readonly windows: OsuStandardTimingValues, difficulty_multiplier: number) {
    if (!Number.isInteger(difficulty_multiplier) || difficulty_multiplier < 0) {
      throw new Error("osu!standard difficulty multiplier must be a non-negative integer");
    }
    this.difficulty_multiplier = difficulty_multiplier;
  }

  receive(event: OsuStandardJudgmentEvent): void {
    const judge_index = OSU_STANDARD_JUDGE_NAMES.indexOf(classifyOsuStandardJudgment(this.windows, event));
    this.add(judge_index);
  }

  getScore(): number {
    return this.score;
  }

  getAccuracy(): number {
    const total = this.judge_counts.reduce((sum, count) => sum + count, 0);
    if (total === 0) return 1;
    return this.judge_counts.reduce((sum, count, index) => sum + count * BASE_SCORES[index]!, 0) / (total * 300);
  }

  getGrade(): OsuStandardGrade {
    const total = this.judge_counts.reduce((sum, count) => sum + count, 0);
    if (total === 0) return "X";
    const ratio_300 = this.judge_counts[0]! / total;
    const ratio_50 = this.judge_counts[2]! / total;
    const misses = this.judge_counts[3]!;
    if (ratio_300 === 1) return "X";
    if (ratio_300 > 0.9 && ratio_50 <= 0.01 && misses === 0) return "S";
    if ((ratio_300 > 0.8 && misses === 0) || ratio_300 > 0.9) return "A";
    if ((ratio_300 > 0.7 && misses === 0) || ratio_300 > 0.8) return "B";
    if (ratio_300 > 0.6) return "C";
    return "D";
  }

  getCombo(): number {
    return this.combo;
  }

  getMaxCombo(): number {
    return this.max_combo;
  }

  getJudges(): readonly number[] {
    return this.judge_counts;
  }

  getLastJudge(): OsuStandardJudge | null {
    return this.last_judge_index === null ? null : OSU_STANDARD_JUDGE_NAMES[this.last_judge_index]!;
  }

  private add(index: number): void {
    const base_score = BASE_SCORES[index]!;
    if (base_score === 0) {
      this.combo = 0;
    } else {
      // Stable applies the combo bonus before incrementing combo. No-mod ScoreV1
      // uses an integer difficulty multiplier and integer division by 25.
      this.score += base_score + Math.max(0, this.combo - 1) * Math.floor(base_score / 25) * this.difficulty_multiplier;
      this.combo += 1;
      this.max_combo = Math.max(this.max_combo, this.combo);
    }
    this.judge_counts[index] = this.judge_counts[index]! + 1;
    this.last_judge_index = index;
  }
}
