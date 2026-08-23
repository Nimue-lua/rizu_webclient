import type { LogicEvent } from "../LogicEvent";
import { isAccuracySource, isComboSource, isGradeSource, isJudgesSource, isScoreSource,
  type IAccuracySource, type IComboSource, type IGradeSource, type IJudgesSource,
  type IScoreSource } from "./ScoreSources";
import type { ScoreSystem } from "./ScoreSystem";

export interface ScoreResult {
  score?: number;
  accuracy?: number;
  grade?: string;
  combo?: number;
  max_combo?: number;
  judges?: Readonly<Record<string, number>>;
  judge_names?: readonly string[];
  last_judge?: string | null;
}

export class ScoreEngine {
  private score_source?: IScoreSource;
  private accuracy_source?: IAccuracySource;
  private grade_source?: IGradeSource;
  private combo_source?: IComboSource;
  private judges_source?: IJudgesSource;

  constructor(private readonly systems: readonly ScoreSystem[]) {
    for (const system of systems) {
      if (isScoreSource(system)) this.score_source = system;
      if (isAccuracySource(system)) this.accuracy_source = system;
      if (isGradeSource(system)) this.grade_source = system;
      if (isComboSource(system)) this.combo_source = system;
      if (isJudgesSource(system)) this.judges_source = system;
    }
  }

  receive(event: LogicEvent): void {
    for (const system of this.systems) system.receive(event);
  }

  getResult(): ScoreResult {
    const result: ScoreResult = {};
    if (this.score_source) result.score = this.score_source.getScore();
    if (this.accuracy_source) result.accuracy = this.accuracy_source.getAccuracy();
    if (this.grade_source) result.grade = this.grade_source.getGrade();
    if (this.combo_source) {
      result.combo = this.combo_source.getCombo();
      result.max_combo = this.combo_source.getMaxCombo();
    }
    if (this.judges_source) {
      const names = this.judges_source.judge_names;
      const counts = this.judges_source.getJudges();
      result.judge_names = names;
      result.judges = Object.fromEntries(names.map((name, index) => [name, counts[index] ?? 0]));
      result.last_judge = this.judges_source.getLastJudge();
    }
    return result;
  }
}
