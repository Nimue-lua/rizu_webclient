export interface IScoreSource {
  getScore(): number;
}

export interface IAccuracySource {
  getAccuracy(): number;
}

export interface IComboSource {
  getCombo(): number;
  getMaxCombo(): number;
}

export interface IJudgesSource {
  readonly judge_names: readonly string[];
  getJudges(): readonly number[];
  getLastJudge(): string | null;
}

function hasMethod(value: object, method: string): boolean {
  return method in value && typeof (value as Record<string, unknown>)[method] === "function";
}

export function isScoreSource(value: object): value is IScoreSource {
  return hasMethod(value, "getScore");
}

export function isAccuracySource(value: object): value is IAccuracySource {
  return hasMethod(value, "getAccuracy");
}

export function isComboSource(value: object): value is IComboSource {
  return hasMethod(value, "getCombo") && hasMethod(value, "getMaxCombo");
}

export function isJudgesSource(value: object): value is IJudgesSource {
  return "judge_names" in value && hasMethod(value, "getJudges") && hasMethod(value, "getLastJudge");
}
