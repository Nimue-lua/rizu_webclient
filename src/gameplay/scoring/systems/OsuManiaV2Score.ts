import { NoteState, type LogicEvent } from "../../LogicEvent";
import { normalizeOsuOd } from "../../timing/OsuManiaV2Timings";
import type { IAccuracySource, IGradeSource, IJudgesSource } from "../ScoreSources";
import type { ScoreSystem } from "../ScoreSystem";

export const OSU_MANIA_V2_JUDGE_NAMES = ["perfect", "great", "good", "ok", "meh", "miss"] as const;
export type OsuManiaV2Judge = typeof OSU_MANIA_V2_JUDGE_NAMES[number];
export type OsuManiaV2Grade = "X" | "S" | "A" | "B" | "C" | "D";

const JUDGE_WEIGHTS = [305, 300, 200, 100, 50, 0] as const;

export class OsuManiaV2Score implements ScoreSystem, IAccuracySource, IGradeSource, IJudgesSource {
  readonly key: string;
  readonly judge_names = OSU_MANIA_V2_JUDGE_NAMES;
  private readonly windows: readonly number[];
  private readonly judge_counts = OSU_MANIA_V2_JUDGE_NAMES.map(() => 0);
  private last_judge_index: number | null = null;

  constructor(od: number) {
    const normalized_od = normalizeOsuOd(od);
    const od3 = normalized_od * 3;
    const perfect = normalized_od < 5 ? 22.4 - 0.6 * normalized_od : 24.9 - 1.1 * normalized_od;
    this.key = `osu_mania_v2_od${normalized_od}`;
    this.windows = [perfect / 1000, (64 - od3) / 1000, (97 - od3) / 1000,
      (127 - od3) / 1000, (151 - od3) / 1000, (188 - od3) / 1000];
  }

  receive(event: LogicEvent): void {
    if (event.type === "tap") {
      if (event.old_state === NoteState.Clear && event.new_state === NoteState.Passed) this.hit(event.delta_time);
      else if (event.old_state === NoteState.Clear && event.new_state === NoteState.Missed) this.miss();
      return;
    }
    if (event.old_state === NoteState.Clear) {
      if (event.new_state === NoteState.StartPassedPressed) this.hit(event.delta_time);
      else if (event.new_state === NoteState.StartMissed || event.new_state === NoteState.StartMissedPressed) this.miss();
    } else if (event.old_state === NoteState.StartPassedPressed) {
      if (event.new_state === NoteState.EndPassed) this.hit(event.delta_time, true);
      else if (event.new_state === NoteState.StartMissed || event.new_state === NoteState.EndMissed) this.miss();
    } else if (event.old_state === NoteState.StartMissedPressed && event.new_state === NoteState.EndMissedPassed) {
      this.hit(event.delta_time, true);
    } else if (event.old_state === NoteState.StartMissed && event.new_state === NoteState.EndMissed) {
      this.miss();
    }
  }

  getAccuracy(): number {
    let weighted_total = 0;
    let total = 0;
    for (let index = 0; index < this.judge_counts.length; index += 1) {
      const count = this.judge_counts[index]!;
      total += count;
      weighted_total += count * JUDGE_WEIGHTS[index]!;
    }
    return total === 0 ? 0 : weighted_total / (JUDGE_WEIGHTS[0] * total);
  }

  getGrade(): OsuManiaV2Grade {
    const accuracy = this.getAccuracy();
    if (accuracy === 1) return "X";
    if (accuracy > 0.95) return "S";
    if (accuracy > 0.9) return "A";
    if (accuracy > 0.8) return "B";
    if (accuracy > 0.7) return "C";
    return "D";
  }

  getJudges(): readonly number[] {
    return this.judge_counts;
  }

  getLastJudge(): OsuManiaV2Judge | null {
    return this.last_judge_index === null ? null : OSU_MANIA_V2_JUDGE_NAMES[this.last_judge_index]!;
  }

  private hit(delta_time: number, release = false): void {
    const normalized_delta = Math.abs(release ? delta_time / 1.5 : delta_time);
    const judge_index = this.windows.findIndex((window) => normalized_delta <= window);
    this.add(judge_index < 0 ? this.windows.length - 1 : judge_index);
  }

  private miss(): void {
    this.add(this.windows.length - 1);
  }

  private add(index: number): void {
    this.judge_counts[index] = this.judge_counts[index]! + 1;
    this.last_judge_index = index;
  }
}
