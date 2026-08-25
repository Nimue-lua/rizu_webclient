import type { ScoreResult } from "./scoring/ScoreResult";
import { SpringValue } from "./SpringValue";

export interface HudState {
  readonly score: number;
  readonly accuracy: number;
}

export interface GameplayPresentationState {
  readonly hud: HudState;
  readonly combo: number;
  readonly comboAnimationAge: number;
  readonly comboAnimationFrom: number;
  readonly judgment: string | null;
  readonly judgmentAge: number;
}

export class HudStateDeriver {
  private readonly displayed_accuracy = new SpringValue(0);
  private previous_frame_time: number | null = null;
  private previous_judges_total = 0;
  private judgment_time = -Infinity;
  private previous_combo = 0;
  private combo_animation_from = 0;
  private combo_animation_time = -Infinity;

  update(score: ScoreResult, frame_time: number): GameplayPresentationState {
    const delta_time = this.previous_frame_time === null ? 0 : frame_time - this.previous_frame_time;
    this.previous_frame_time = frame_time;
    const judges_total = Object.values(score.judges ?? {}).reduce((total, count) => total + count, 0);
    if (judges_total !== this.previous_judges_total) {
      this.judgment_time = frame_time;
      this.previous_judges_total = judges_total;
    }
    const combo = score.combo ?? 0;
    if (combo > this.previous_combo) {
      this.combo_animation_from = this.previous_combo;
      this.combo_animation_time = frame_time;
    } else if (combo < this.previous_combo) {
      this.combo_animation_time = -Infinity;
    }
    this.previous_combo = combo;
    return {
      hud: {
        score: score.score ?? 0,
        accuracy: this.displayed_accuracy.update((score.accuracy ?? 0) * 100, delta_time),
      },
      combo,
      comboAnimationAge: frame_time - this.combo_animation_time,
      comboAnimationFrom: this.combo_animation_from,
      judgment: score.last_judge ?? null,
      judgmentAge: frame_time - this.judgment_time,
    };
  }
}
