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
  readonly hitErrorMeter: HitErrorMeterState;
}

export interface HitErrorTick {
  readonly deltaTime: number;
  readonly age: number;
}

export interface HitErrorMeterState {
  readonly windows: readonly [number, number, number] | null;
  readonly ticks: readonly HitErrorTick[];
  readonly floatingError: number;
  readonly age: number;
}

export class HudStateDeriver {
  private readonly displayed_score = new SpringValue(0);
  private readonly displayed_accuracy = new SpringValue(0);
  private previous_frame_time: number | null = null;
  private previous_judges_total = 0;
  private judgment_time = -Infinity;
  private previous_combo = 0;
  private combo_animation_from = 0;
  private combo_animation_time = -Infinity;
  private hit_error_sequence = 0;
  private hit_error_time = -Infinity;
  private hit_error_windows: readonly [number, number, number] | null = null;
  private floating_error_target = 0;
  private floating_error_from = 0;
  private floating_error_move_time = -Infinity;
  private readonly hit_errors: Array<{ deltaTime: number; time: number }> = [];

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
    const move_progress = Math.min(1, Math.max(0, (frame_time - this.floating_error_move_time) / 0.8));
    const move_easing = 1 - (1 - move_progress) * (1 - move_progress);
    let floating_error = this.floating_error_from +
      (this.floating_error_target - this.floating_error_from) * move_easing;
    const hit_error = score.hit_error;
    if (hit_error && hit_error.sequence !== this.hit_error_sequence) {
      this.hit_error_sequence = hit_error.sequence;
      this.hit_error_time = frame_time;
      this.hit_error_windows = hit_error.windows;
      const range = hit_error.windows[2];
      const clamped_error = Math.max(-range, Math.min(range, hit_error.delta_time));
      this.floating_error_from = floating_error;
      this.floating_error_target = this.floating_error_target * 0.8 + clamped_error * 0.2;
      this.floating_error_move_time = frame_time;
      floating_error = this.floating_error_from;
      this.hit_errors.push({ deltaTime: clamped_error, time: frame_time });
    }
    while (this.hit_errors[0] && frame_time - this.hit_errors[0].time >= 10) this.hit_errors.shift();
    return {
      hud: {
        score: this.displayed_score.update(score.score ?? 0, delta_time),
        accuracy: this.displayed_accuracy.update((score.accuracy ?? 0) * 100, delta_time),
      },
      combo,
      comboAnimationAge: frame_time - this.combo_animation_time,
      comboAnimationFrom: this.combo_animation_from,
      judgment: score.last_judge ?? null,
      judgmentAge: frame_time - this.judgment_time,
      hitErrorMeter: {
        windows: this.hit_error_windows,
        ticks: this.hit_errors.map((error) => ({ deltaTime: error.deltaTime, age: frame_time - error.time })),
        floatingError: floating_error,
        age: frame_time - this.hit_error_time,
      },
    };
  }
}
