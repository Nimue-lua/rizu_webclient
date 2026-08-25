import type { OsuChart, OsuSlider } from "../../chart/Chart";
import { osuApproachPreempt, osuCircleDiameter } from "../OsuCircleGeometry";
import type { OsuCircleTransient } from "../OsuCirclePresentation";
import { OsuCircleState } from "../OsuCircleState";
import { OsuViewport } from "../OsuViewport";
import type { OsuStandardSkin } from "./OsuSkin";
import type { SpriteQuadWriter } from "./Sprite";
import type { OsuSliderPath } from "../OsuSliderPath";

const CIRCLE_FADE_IN = 0.4;
const APPROACH_FADE_IN = 0.8;
const HIT_FADE_OUT = 0.24;
const MISS_FADE_OUT = 0.06;
const JUDGMENT_FADE_IN = 0.12;
const JUDGMENT_HOLD = 0.5;
const JUDGMENT_LIFETIME = 1.1;

export class OsuPlayfieldRenderer {
  constructor(private readonly skin: OsuStandardSkin) {}

  draw(viewport: OsuViewport, chart: OsuChart, circle_states: Uint8Array, first_active_index: number,
    circle_transients: readonly OsuCircleTransient[], song_time: number, write: SpriteQuadWriter,
    slider_path?: (slider: OsuSlider) => OsuSliderPath | undefined,
    draw_slider?: (slider: OsuSlider, path: OsuSliderPath, alpha: number) => void): void {
    const preempt = osuApproachPreempt(chart.approach_rate);
    const diameter = osuCircleDiameter(chart.circle_size) * viewport.scale;
    const shake_offsets = new Map<number, number>();
    for (const transient of circle_transients) {
      if (transient.kind !== "shake") continue;
      const age = song_time - transient.start_time;
      if (age >= 0 && age < 0.12) shake_offsets.set(transient.object_index, stableShakeOffset(age));
    }
    for (const object of chart.hit_objects) {
      if (object.absolute_time > song_time + preempt) break;
      if (object.kind !== "slider") continue;
      const remaining = object.absolute_time - song_time;
      if (remaining > preempt || song_time > object.end_time) continue;
      const age = preempt - remaining;
      const alpha = Math.min(1, Math.max(0, age / CIRCLE_FADE_IN));
      const path = slider_path?.(object);
      if (path) draw_slider?.(object, path, alpha);
      const endpoint = path?.endPosition(object.repeat_count) ?? { x: object.x, y: object.y };
      this.drawCircle(viewport, endpoint, diameter, alpha, 0, 1, write);
      const approach_alpha = remaining > 0 ? Math.min(0.9, age / Math.min(preempt, APPROACH_FADE_IN) * 0.9) : 0;
      const approach_scale = 1 + 3 * Math.max(0, remaining) / preempt;
      this.drawCircle(viewport, object, diameter, alpha, approach_alpha, approach_scale, write);
    }
    let low = 0;
    let high = chart.hit_objects.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (chart.hit_objects[middle]!.absolute_time <= song_time + preempt) low = middle + 1;
      else high = middle;
    }
    for (let index = low - 1; index >= first_active_index; index -= 1) {
      const circle = chart.hit_objects[index]!;
      if (circle.kind !== "circle") continue;
      if (circle_states[index] !== OsuCircleState.Pending) continue;
      const remaining = circle.absolute_time - song_time;
      if (remaining > preempt) continue;
      const age = preempt - remaining;
      const circle_alpha = Math.min(1, age / CIRCLE_FADE_IN);
      const approach_alpha = remaining > 0
        ? Math.min(0.9, age / Math.min(preempt, APPROACH_FADE_IN) * 0.9)
        : 0;
      const approach_scale = 1 + 3 * Math.max(0, remaining) / preempt;
      const position = {
        x: circle.x + (shake_offsets.get(index) ?? 0),
        y: circle.y,
      };
      this.drawCircle(viewport, position, diameter, circle_alpha, approach_alpha, approach_scale, write);
    }

    for (const transient of circle_transients) {
      if (transient.kind === "shake") continue;
      const age = song_time - transient.start_time;
      if (age < 0 || age >= JUDGMENT_LIFETIME) continue;
      const circle = chart.hit_objects[transient.object_index];
      if (!circle || circle.kind !== "circle") continue;
      const center = viewport.playfieldToScreen(circle);
      const combo = this.skin.comboColor;
      if (transient.kind === "hit" && age < HIT_FADE_OUT) {
        const progress = age / HIT_FADE_OUT;
        const scale = 1 + 0.4 * (2 * progress - progress * progress);
        const alpha = 1 - progress;
        const size = diameter * scale;
        write(center.x - size / 2, center.y - size / 2, size, size,
          [combo[0], combo[1], combo[2], alpha], this.skin.hitCircle);
        write(center.x - size / 2, center.y - size / 2, size, size,
          [1, 1, 1, alpha], this.skin.hitCircleOverlay);
      } else if (transient.kind === "miss" && age < MISS_FADE_OUT) {
        const alpha = 1 - age / MISS_FADE_OUT;
        write(center.x - diameter / 2, center.y - diameter / 2, diameter, diameter,
          [combo[0], combo[1], combo[2], alpha], this.skin.hitCircle);
        write(center.x - diameter / 2, center.y - diameter / 2, diameter, diameter,
          [1, 1, 1, alpha], this.skin.hitCircleOverlay);
      }
      this.drawJudgment(viewport, center, transient.kind === "hit" ? transient.judgment : "miss", age, write);
    }
  }

  private drawCircle(viewport: OsuViewport, position: { x: number; y: number }, diameter: number, alpha: number,
    approach_alpha: number, approach_scale: number, write: SpriteQuadWriter): void {
    const center = viewport.playfieldToScreen(position);
    const addCentered = (size: number, color: readonly [number, number, number, number], sprite: OsuStandardSkin["hitCircle"]) =>
      write(center.x - size / 2, center.y - size / 2, size, size, color, sprite);
    const combo = this.skin.comboColor;
    addCentered(diameter, [combo[0], combo[1], combo[2], alpha], this.skin.hitCircle);
    addCentered(diameter, [1, 1, 1, alpha], this.skin.hitCircleOverlay);
    addCentered(diameter * approach_scale, [combo[0], combo[1], combo[2], approach_alpha], this.skin.approachCircle);
  }

  private drawJudgment(viewport: OsuViewport, center: { x: number; y: number }, judgment: string,
    age: number, write: SpriteQuadWriter): void {
    const frames = this.skin.judgments[judgment] ?? [];
    const frame_name = frames[Math.min(frames.length - 1, Math.floor(age * 60))];
    const sprite = frame_name && this.skin.sprites[frame_name];
    if (!sprite) return;
    let alpha = age < JUDGMENT_FADE_IN ? age / JUDGMENT_FADE_IN
      : age < JUDGMENT_HOLD ? 1
        : (JUDGMENT_LIFETIME - age) / (JUDGMENT_LIFETIME - JUDGMENT_HOLD);
    let scale = 1;
    let y = center.y;
    if (judgment === "miss" && frames.length === 1) {
      scale = age < JUDGMENT_FADE_IN ? 2 - age / JUDGMENT_FADE_IN : 1;
      const progress = age / JUDGMENT_LIFETIME;
      y += (-5 + 45 * progress * progress) * viewport.scale;
    }
    alpha = Math.max(0, Math.min(1, alpha));
    const width = sprite.sourceSize.w * viewport.scale * scale;
    const height = sprite.sourceSize.h * viewport.scale * scale;
    write(center.x - width / 2, y - height / 2, width, height, [1, 1, 1, alpha], sprite);
  }
}

export function stableShakeOffset(age: number): number {
  const milliseconds = age * 1000;
  if (milliseconds < 0 || milliseconds >= 120) return 0;
  if (milliseconds < 20) return interpolate(0, 8, milliseconds / 20);
  if (milliseconds < 40) return interpolate(8, -8, (milliseconds - 20) / 20);
  if (milliseconds < 60) return interpolate(-8, 8, (milliseconds - 40) / 20);
  if (milliseconds < 80) return interpolate(8, -8, (milliseconds - 60) / 20);
  if (milliseconds < 100) return interpolate(8, -8, (milliseconds - 80) / 20);
  return interpolate(8, 0, (milliseconds - 100) / 20);
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}
