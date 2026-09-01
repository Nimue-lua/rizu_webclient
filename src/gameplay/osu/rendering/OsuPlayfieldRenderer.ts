import type { OsuChart, OsuSlider } from "../../../chart/Chart";
import type { OsuStandardSkin } from "../../../noteskin/osu/OsuSkin";
import type { SpriteQuadWriter } from "../../renderer/Sprite";
import { osuApproachPreempt, osuCircleDiameter } from "../OsuCircleGeometry";
import type { OsuCircleTransient } from "../OsuCirclePresentation";
import { OsuCircleState } from "../OsuCircleState";
import type { OsuSliderPresentationState, OsuSpinnerPresentationState } from "../OsuSliderPresentation";
import type { OsuSliderPath } from "../OsuSliderPath";
import { OsuViewport } from "../OsuViewport";
import { drawCircle, stableShakeOffset } from "./OsuCircleRenderer";
import { drawFollowPoints } from "./OsuFollowPointRenderer";
import { drawCircleTransients } from "./OsuJudgmentRenderer";
import { APPROACH_FADE_IN, CIRCLE_FADE_IN, comboColor, type OsuColor } from "./OsuPlayfieldRenderShared";
import { drawSliderForeground, SLIDER_FADE_OUT } from "./OsuSliderForegroundRenderer";
import { drawSpinner } from "./OsuSpinnerRenderer";

export { stableShakeOffset } from "./OsuCircleRenderer";

export class OsuPlayfieldRenderer {
  private chart: OsuChart | null = null;
  private first_render_index = 0;
  private previous_first_active_index = 0;
  private previous_song_time = Number.NEGATIVE_INFINITY;

  constructor(private readonly skin: OsuStandardSkin) {}

  draw(viewport: OsuViewport, chart: OsuChart, circle_states: Uint8Array, first_active_index: number,
    circle_transients: readonly OsuCircleTransient[], song_time: number, write: SpriteQuadWriter,
    slider_path?: (slider: OsuSlider) => OsuSliderPath | undefined,
    draw_slider?: (slider: OsuSlider, path: OsuSliderPath, alpha: number, color: OsuColor) => void,
    slider_states: readonly OsuSliderPresentationState[] | undefined = undefined,
    spinner_state: OsuSpinnerPresentationState | null = null): void {
    const preempt = osuApproachPreempt(chart.approach_rate);
    const diameter = osuCircleDiameter(chart.circle_size) * viewport.scale;
    const shake_offsets = new Map<number, number>();
    for (const transient of circle_transients) {
      if (transient.kind !== "shake") continue;
      const age = song_time - transient.start_time;
      if (age >= 0 && age < 0.12) shake_offsets.set(transient.object_index, stableShakeOffset(age));
    }
    if (spinner_state?.active) drawSpinner(this.skin, viewport, spinner_state, write);
    this.advanceRenderIndex(chart, first_active_index, song_time);
    const last_visible_index = upperBound(chart, song_time + preempt);
    drawFollowPoints(this.skin, viewport, chart, first_active_index, song_time, write, slider_path);

    for (let index = last_visible_index - 1; index >= this.first_render_index; index -= 1) {
      const object = chart.hit_objects[index]!;
      if (object.kind === "circle") {
        if (index < first_active_index || circle_states[index] !== OsuCircleState.Pending) continue;
        const remaining = object.absolute_time - song_time;
        const age = preempt - remaining;
        const circle_alpha = Math.min(1, age / CIRCLE_FADE_IN);
        const approach_alpha = remaining > 0
          ? Math.min(0.9, age / Math.min(preempt, APPROACH_FADE_IN) * 0.9)
          : 0;
        const approach_scale = 1 + 3 * Math.max(0, remaining) / preempt;
        const position = { x: object.x + (shake_offsets.get(index) ?? 0), y: object.y };
        drawCircle(this.skin, viewport, position, diameter, circle_alpha, approach_alpha, approach_scale,
          comboColor(this.skin, chart, object.combo_color_index ?? 0), object.combo_number ?? null, write);
        continue;
      }
      if (object.kind !== "slider" || song_time - object.end_time >= SLIDER_FADE_OUT) continue;
      const slider_state = slider_states?.find((state) => state.object_index === index && state.active);
      drawSliderForeground(this.skin, viewport, object, slider_path?.(object), slider_state,
        slider_states !== undefined, circle_states[index] === OsuCircleState.Pending, song_time, preempt, diameter,
        comboColor(this.skin, chart, object.combo_color_index), write, draw_slider);
    }

    drawCircleTransients(this.skin, viewport, chart, circle_transients, song_time, diameter, write);
  }

  private advanceRenderIndex(chart: OsuChart, first_active_index: number, song_time: number): void {
    if (chart !== this.chart || song_time < this.previous_song_time ||
      first_active_index < this.previous_first_active_index) {
      this.chart = chart;
      this.first_render_index = 0;
    }
    while (this.first_render_index < first_active_index) {
      const object = chart.hit_objects[this.first_render_index]!;
      if (object.kind === "slider" && song_time - object.end_time < SLIDER_FADE_OUT) break;
      this.first_render_index += 1;
    }
    this.previous_song_time = song_time;
    this.previous_first_active_index = first_active_index;
  }
}

function upperBound(chart: OsuChart, absolute_time: number): number {
  let low = 0;
  let high = chart.hit_objects.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (chart.hit_objects[middle]!.absolute_time <= absolute_time) low = middle + 1;
    else high = middle;
  }
  return low;
}
