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
const SLIDER_FADE_OUT = 0.24;
const JUDGMENT_FADE_IN = 0.12;
const JUDGMENT_HOLD = 0.5;
const JUDGMENT_LIFETIME = 1.1;
const OSU_HIT_OBJECT_TEXTURE_SIZE = 128;
const REVERSE_ARROW_FADE_IN = 0.15;

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
      const end_age = song_time - object.end_time;
      if (remaining > preempt || end_age >= SLIDER_FADE_OUT) continue;
      const age = preempt - remaining;
      const fade_in_alpha = Math.min(1, Math.max(0, age / CIRCLE_FADE_IN));
      const fade_out_alpha = end_age > 0 ? Math.max(0, 1 - end_age / SLIDER_FADE_OUT) : 1;
      const alpha = fade_in_alpha * fade_out_alpha;
      const path = slider_path?.(object);
      if (path) draw_slider?.(object, path, alpha);
      const endpoint = path?.endPosition(object.repeat_count) ?? { x: object.x, y: object.y };
      this.drawCircle(viewport, endpoint, diameter, alpha, 0, 1, write);
      const approach_alpha = remaining > 0
        ? Math.min(0.9, age / Math.min(preempt, APPROACH_FADE_IN) * 0.9)
        : 0;
      const approach_scale = 1 + 3 * Math.max(0, remaining) / preempt;
      this.drawCircle(viewport, object, diameter, alpha, approach_alpha, approach_scale, write);
      if (path && object.tick_distances.length > 0 && song_time < object.end_time) {
        this.drawSliderTicks(viewport, object, path, song_time, diameter, alpha, preempt, write);
      }
      if (path && song_time >= object.absolute_time && song_time <= object.end_time) {
        this.drawSliderBall(viewport, object, path, song_time, diameter, write);
      }
      if (path && object.repeat_count > 1 && song_time < object.end_time) {
        this.drawReverseArrow(viewport, object, path, song_time, diameter, alpha, preempt, write);
      }
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

  private drawSliderTicks(viewport: OsuViewport, slider: OsuSlider, path: OsuSliderPath, song_time: number,
    circle_diameter: number, slider_alpha: number, preempt: number, write: SpriteQuadWriter): void {
    const sprite = this.skin.sliderTick;
    if (!sprite || slider.span_duration <= 0 || path.length <= 0) return;
    const elapsed = Math.max(0, song_time - slider.absolute_time);
    const span_index = Math.min(slider.repeat_count - 1, Math.floor(elapsed / slider.span_duration));
    const span_start = slider.absolute_time + span_index * slider.span_duration;
    const reverse = span_index % 2 === 1;
    const distances = reverse ? [...slider.tick_distances].reverse() : slider.tick_distances;
    const radius = circle_diameter / (2 * viewport.scale);
    const start = path.positionAtDistance(0);
    const end = path.positionAtDistance(path.length);
    const scale = circle_diameter / OSU_HIT_OBJECT_TEXTURE_SIZE;
    const width = sprite.sourceSize.w * scale;
    const height = sprite.sourceSize.h * scale;
    for (const distance of distances) {
      const traversal_distance = reverse ? path.length - distance : distance;
      const tick_time = span_start + traversal_distance / path.length * slider.span_duration;
      if (song_time >= tick_time) continue;
      const position = path.positionAtDistance(distance);
      if (distanceSquared(position, start) < radius * radius || distanceSquared(position, end) < radius * radius) continue;
      const first_appear = slider.absolute_time - preempt * 2 / 3 +
        (tick_time - slider.absolute_time) / 2;
      const appear_time = span_index === 0 ? first_appear : span_start + (tick_time - span_start) / 2 - 0.2;
      const tick_alpha = Math.min(1, Math.max(0, (song_time - appear_time) / 0.15));
      if (tick_alpha <= 0) continue;
      const center = viewport.playfieldToScreen(position);
      write(center.x - width / 2, center.y - height / 2, width, height,
        [1, 1, 1, slider_alpha * tick_alpha], sprite);
    }
  }

  private drawReverseArrow(viewport: OsuViewport, slider: OsuSlider, path: OsuSliderPath, song_time: number,
    circle_diameter: number, slider_alpha: number, preempt: number, write: SpriteQuadWriter): void {
    const sprite = this.skin.reverseArrow;
    if (!sprite || slider.span_duration <= 0) return;
    const elapsed = Math.max(0, song_time - slider.absolute_time);
    const span_index = Math.min(slider.repeat_count - 1, Math.floor(elapsed / slider.span_duration));
    if (span_index >= slider.repeat_count - 1) return;
    const at_end = span_index % 2 === 0;
    const progress = at_end ? 1 : 0;
    const center = viewport.playfieldToScreen(path.positionAtProgress(progress));
    const direction = path.directionAtProgress(progress);
    const outgoing_x = (at_end ? -1 : 1) * direction.x * (viewport.x_flip ? -1 : 1);
    const outgoing_y = (at_end ? -1 : 1) * direction.y * (viewport.y_flip ? -1 : 1);
    const rotation = Math.atan2(outgoing_y, outgoing_x);
    const repeat_time = slider.absolute_time + (span_index + 1) * slider.span_duration;
    const appear_time = span_index === 0
      ? slider.absolute_time - preempt
      : slider.absolute_time + span_index * slider.span_duration;
    const fade_alpha = Math.min(1, Math.max(0, (song_time - appear_time) / REVERSE_ARROW_FADE_IN));
    if (song_time >= repeat_time || fade_alpha <= 0) return;
    const scale = circle_diameter / OSU_HIT_OBJECT_TEXTURE_SIZE;
    const width = sprite.sourceSize.w * scale;
    const height = sprite.sourceSize.h * scale;
    write(center.x - width / 2, center.y - height / 2, width, height,
      [1, 1, 1, slider_alpha * fade_alpha], sprite, false, undefined, false, rotation);
  }

  private drawSliderBall(viewport: OsuViewport, slider: OsuSlider, path: OsuSliderPath, song_time: number,
    circle_diameter: number, write: SpriteQuadWriter): void {
    const frames = this.skin.sliderBallFrames ?? [];
    if (frames.length === 0 || slider.span_duration <= 0) return;
    const elapsed = Math.min(Math.max(song_time - slider.absolute_time, 0), slider.total_duration);
    const span_index = Math.min(slider.repeat_count - 1, Math.floor(elapsed / slider.span_duration));
    const span_elapsed = elapsed - span_index * slider.span_duration;
    const span_progress = Math.min(1, Math.max(0, span_elapsed / slider.span_duration));
    const progress = span_index % 2 === 0 ? span_progress : 1 - span_progress;
    const center = viewport.playfieldToScreen(path.positionAtProgress(progress));
    const velocity = path.length / slider.span_duration;
    const frame_delay = Math.max(2.5 / Math.max(velocity, Number.EPSILON), 1 / 60);
    const animation_frame = Math.floor(elapsed / frame_delay);
    const frame_index = span_index % 2 === 0
      ? animation_frame % frames.length
      : (frames.length - 1 - animation_frame % frames.length + frames.length) % frames.length;
    const frame = frames[frame_index]!;
    const circle_scale = circle_diameter / OSU_HIT_OBJECT_TEXTURE_SIZE;
    const width = frame.sourceSize.w * circle_scale;
    const height = frame.sourceSize.h * circle_scale;
    const direction = path.directionAtProgress(progress);
    const screen_x = (viewport.x_flip ? -1 : 1) * direction.x;
    const screen_y = (viewport.y_flip ? -1 : 1) * direction.y;
    const rotation = Math.atan2(screen_y, screen_x);
    write(center.x - width / 2, center.y - height / 2, width, height, [1, 1, 1, 1], frame,
      false, undefined, false, rotation);
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

function distanceSquared(first: { x: number; y: number }, second: { x: number; y: number }): number {
  const x = first.x - second.x;
  const y = first.y - second.y;
  return x * x + y * y;
}
