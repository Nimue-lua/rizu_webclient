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
