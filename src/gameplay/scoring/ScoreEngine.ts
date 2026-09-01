import { isAccuracySource, isComboSource, isGradeSource, isHitErrorSource, isJudgesSource, isScoreSource,
  type IAccuracySource, type IComboSource, type IGradeSource, type IJudgesSource,
  type IHitErrorSource, type IScoreSource } from "./ScoreSources";
import type { ScoreSystem } from "./ScoreSystem";
import type { HitErrorResult, ScoreResult } from "./ScoreResult";

export class ScoreEngine<Event> {
  private score_source?: IScoreSource;
  private accuracy_source?: IAccuracySource;
  private grade_source?: IGradeSource;
  private combo_source?: IComboSource;
  private judges_source?: IJudgesSource;
  private hit_error_source?: IHitErrorSource;
  private latest_result: ScoreResult;
  readonly results: ScoreResult[] = [];
  private hit_error_sequence = 0;
  private latest_hit_error?: HitErrorResult;

  constructor(private readonly systems: readonly ScoreSystem<Event>[]) {
    for (const system of systems) {
      if (isScoreSource(system)) this.score_source = system;
      if (isAccuracySource(system)) this.accuracy_source = system;
      if (isGradeSource(system)) this.grade_source = system;
      if (isComboSource(system)) this.combo_source = system;
      if (isJudgesSource(system)) this.judges_source = system;
      if (isHitErrorSource(system)) this.hit_error_source = system;
    }
    this.latest_result = this.createResult();
  }

  receive(event: Event): void {
    for (const system of this.systems) system.receive(event);
    const hit_error = this.hit_error_source?.getHitError();
    if (hit_error) this.latest_hit_error = Object.freeze({ ...hit_error, sequence: ++this.hit_error_sequence });
    this.latest_result = this.createResult();
    this.results.push(this.latest_result);
  }

  getResult(): ScoreResult {
    return this.latest_result;
  }

  private createResult(): ScoreResult {
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
      const judges: Record<string, number> = {};
      for (let index = 0; index < names.length; index += 1) judges[names[index]!] = counts[index] ?? 0;
      result.judges = Object.freeze(judges);
      result.last_judge = this.judges_source.getLastJudge();
    }
    if (this.latest_hit_error) result.hit_error = this.latest_hit_error;
    return Object.freeze(result);
  }
}
