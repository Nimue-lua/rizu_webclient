import type { CompletedGameplay } from "./RecordedReplay";

export interface ResultsController {
  readonly completed: CompletedGameplay | null;
  readonly score_revision: number;
  delete_scores(): Promise<void>;
}
