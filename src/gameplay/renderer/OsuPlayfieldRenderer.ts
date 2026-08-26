import type { OsuChart, OsuSlider } from "../../chart/Chart";
import { osuApproachPreempt, osuCircleDiameter } from "../OsuCircleGeometry";
import type { OsuCircleTransient } from "../OsuCirclePresentation";
import { OsuCircleState } from "../OsuCircleState";
import { OsuViewport } from "../OsuViewport";
import type { OsuStandardSkin } from "./OsuSkin";
import type { SpriteQuadWriter } from "./Sprite";
import type { OsuSliderPath } from "../OsuSliderPath";
import type { OsuSliderPresentationState, OsuSpinnerPresentationState } from "../OsuSliderPresentation";
import { drawBitmapText } from "./BitmapTextRenderer";

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
const FOLLOW_FADE_IN = 0.06;
const FOLLOW_SCALE_IN = 0.18;

export class OsuPlayfieldRenderer {
  constructor(private readonly skin: OsuStandardSkin) {}

  draw(viewport: OsuViewport, chart: OsuChart, circle_states: Uint8Array, first_active_index: number,
    circle_transients: readonly OsuCircleTransient[], song_time: number, write: SpriteQuadWriter,
    slider_path?: (slider: OsuSlider) => OsuSliderPath | undefined,
    draw_slider?: (slider: OsuSlider, path: OsuSliderPath, alpha: number,
      color: readonly [number, number, number, number]) => void,
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
    if (spinner_state?.active) this.drawSpinner(viewport, spinner_state, write);
    let low = 0;
    let high = chart.hit_objects.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (chart.hit_objects[middle]!.absolute_time <= song_time + preempt) low = middle + 1;
      else high = middle;
    }
    for (let index = low - 1; index >= 0; index -= 1) {
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
        const position = {
          x: object.x + (shake_offsets.get(index) ?? 0),
          y: object.y,
        };
        this.drawCircle(viewport, position, diameter, circle_alpha, approach_alpha, approach_scale,
          this.comboColor(chart, object.combo_color_index ?? 0), object.combo_number ?? null, write);
        continue;
      }
      if (object.kind !== "slider") continue;
      const remaining = object.absolute_time - song_time;
      const end_age = song_time - object.end_time;
      if (end_age >= SLIDER_FADE_OUT) continue;
      const age = preempt - remaining;
      const fade_in_alpha = Math.min(1, Math.max(0, age / CIRCLE_FADE_IN));
      const fade_out_alpha = end_age > 0 ? Math.max(0, 1 - end_age / SLIDER_FADE_OUT) : 1;
      const alpha = fade_in_alpha * fade_out_alpha;
      const combo = this.comboColor(chart, object.combo_color_index);
      const path = slider_path?.(object);
      if (path) draw_slider?.(object, path, alpha, combo);
      const endpoint = path?.endPosition(object.repeat_count) ?? { x: object.x, y: object.y };
      this.drawSliderEndCircle(viewport, endpoint, diameter, alpha, combo, write);
      const slider_state = slider_states?.find((state) => state.object_index === index && state.active);
      const head_fade_duration = slider_state?.head_successful ? HIT_FADE_OUT : MISS_FADE_OUT;
      const head_alpha = slider_state
        ? Math.min(alpha, Math.max(0, 1 - (song_time - slider_state.head_resolved_at) / head_fade_duration))
        : slider_states !== undefined && circle_states[index] !== OsuCircleState.Pending ? 0
        : alpha;
      const head_hit_progress = slider_state?.head_successful
        ? Math.min(1, Math.max(0, (song_time - slider_state.head_resolved_at) / HIT_FADE_OUT))
        : 0;
      const head_scale = 1 + 0.4 * (2 * head_hit_progress - head_hit_progress * head_hit_progress);
      const approach_alpha = remaining > 0
        ? Math.min(0.9, age / Math.min(preempt, APPROACH_FADE_IN) * 0.9)
        : 0;
      const approach_scale = 1 + 3 * Math.max(0, remaining) / preempt;
      this.drawCircle(viewport, object, diameter, head_alpha, slider_state ? 0 : approach_alpha, approach_scale,
        combo, object.combo_number, write, head_scale, slider_state?.head_successful ? 0 : head_alpha);
      if (path && object.tick_distances.length > 0 && song_time < object.end_time) {
        this.drawSliderTicks(viewport, object, path, song_time, diameter, alpha, preempt, write);
      }
      if (path && song_time >= object.absolute_time && (slider_states === undefined || slider_state)) {
        this.drawSliderBall(viewport, object, path, song_time, diameter, write);
        if (slider_state?.tracking) this.drawSliderFollowCircle(viewport, slider_state, song_time, diameter, write);
      }
      if (path && object.repeat_count > 1 && song_time < object.end_time) {
        this.drawReverseArrow(viewport, object, path, song_time, diameter, alpha, preempt, write);
      }
    }

    for (const transient of circle_transients) {
      if (transient.kind === "shake") continue;
      const age = song_time - transient.start_time;
      if (age < 0 || age >= JUDGMENT_LIFETIME) continue;
      const object = chart.hit_objects[transient.object_index];
      if (!object) continue;
      const center = viewport.playfieldToScreen(transient.position ?? object);
      const combo = this.comboColor(chart, object.combo_color_index ?? 0);
      if (object.kind === "circle" && transient.kind === "hit" && age < HIT_FADE_OUT) {
        const progress = age / HIT_FADE_OUT;
        const scale = 1 + 0.4 * (2 * progress - progress * progress);
        const alpha = 1 - progress;
        const size = diameter * scale;
        write(center.x - size / 2, center.y - size / 2, size, size,
          [combo[0], combo[1], combo[2], alpha], this.skin.hitCircle);
        write(center.x - size / 2, center.y - size / 2, size, size,
          [1, 1, 1, alpha], this.skin.hitCircleOverlay);
      } else if (object.kind === "circle" && transient.kind === "miss" && age < MISS_FADE_OUT) {
        const alpha = 1 - age / MISS_FADE_OUT;
        write(center.x - diameter / 2, center.y - diameter / 2, diameter, diameter,
          [combo[0], combo[1], combo[2], alpha], this.skin.hitCircle);
        write(center.x - diameter / 2, center.y - diameter / 2, diameter, diameter,
          [1, 1, 1, alpha], this.skin.hitCircleOverlay);
      }
      this.drawJudgment(viewport, center, transient.kind === "hit" ? transient.judgment : "miss", age,
        diameter / OSU_HIT_OBJECT_TEXTURE_SIZE, write);
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

  private drawSliderFollowCircle(viewport: OsuViewport, state: OsuSliderPresentationState, song_time: number,
    circle_diameter: number, write: SpriteQuadWriter): void {
    const sprite = this.skin.sliderFollowCircle;
    if (!sprite || state.tracking_started_at === null) return;
    const center = viewport.playfieldToScreen(state.position);
    const scale = circle_diameter / OSU_HIT_OBJECT_TEXTURE_SIZE;
    const age = Math.max(0, song_time - state.tracking_started_at);
    const scale_progress = Math.min(1, age / FOLLOW_SCALE_IN);
    const active_scale = 0.5 + 0.5 * (1 - (1 - scale_progress) * (1 - scale_progress));
    const width = sprite.sourceSize.w * scale * active_scale;
    const height = sprite.sourceSize.h * scale * active_scale;
    write(center.x - width / 2, center.y - height / 2, width, height,
      [1, 1, 1, Math.min(1, age / FOLLOW_FADE_IN)], sprite);
  }

  private drawSpinner(viewport: OsuViewport, state: OsuSpinnerPresentationState, write: SpriteQuadWriter): void {
    const center = viewport.playfieldToScreen({ x: 256, y: 192 });
    const addCentered = (sprite: OsuStandardSkin["spinnerCircle"], rotation = 0, scale = 1) => {
      if (!sprite) return;
      const width = sprite.sourceSize.w * viewport.scale * scale;
      const height = sprite.sourceSize.h * viewport.scale * scale;
      write(center.x - width / 2, center.y - height / 2, width, height, [1, 1, 1, state.opacity], sprite,
        false, undefined, false, rotation);
    };
    const legacy = this.skin.spinnerCircle !== undefined;
    if (legacy) {
      addCentered(this.skin.spinnerBackground);
      addCentered(this.skin.spinnerCircle, state.rotation_radians);
      addCentered(this.skin.spinnerMetre);
    } else {
      const layers = [this.skin.spinnerBottom, this.skin.spinnerMiddle, this.skin.spinnerTop].filter(Boolean);
      const layered_scale = layers.length === 0 ? 1 : Math.min(1,
        512 / Math.max(...layers.map((sprite) => sprite!.sourceSize.w)),
        384 / Math.max(...layers.map((sprite) => sprite!.sourceSize.h)));
      addCentered(this.skin.spinnerBottom, 0, layered_scale);
      addCentered(this.skin.spinnerMiddle, 0, layered_scale);
      addCentered(this.skin.spinnerTop, state.rotation_radians, layered_scale);
    }
    addCentered(this.skin.spinnerApproachCircle, 0, 1.86 - 1.76 * state.duration_progress);

    const rpm_background = this.skin.spinnerRpm;
    const eased_fade_in = 1 - (1 - state.fade_in_progress) * (1 - state.fade_in_progress);
    const y = viewport.stage_top + (447 - 50 * eased_fade_in) * viewport.scale;
    if (rpm_background) {
      const width = rpm_background.sourceSize.w * viewport.scale;
      const height = rpm_background.sourceSize.h * viewport.scale;
      const x = center.x - width / 2;
      write(x, y, width, height, [1, 1, 1, state.opacity], rpm_background);
    }
    drawBitmapText(this.skin.sprites, String(Math.round(state.rpm)), this.skin.scoreGlyphs, this.skin.scoreOverlap,
      center.x + 80 * viewport.scale, y + 3 * viewport.scale, 0.9 * viewport.scale, "right", write, state.opacity);
  }

  private drawCircle(viewport: OsuViewport, position: { x: number; y: number }, diameter: number, alpha: number,
    approach_alpha: number, approach_scale: number, combo: readonly [number, number, number, number],
    combo_number: number | null, write: SpriteQuadWriter, circle_scale = 1, number_alpha = alpha): void {
    const center = viewport.playfieldToScreen(position);
    const addCentered = (size: number, color: readonly [number, number, number, number], sprite: OsuStandardSkin["hitCircle"]) =>
      write(center.x - size / 2, center.y - size / 2, size, size, color, sprite);
    addCentered(diameter * circle_scale, [combo[0], combo[1], combo[2], alpha], this.skin.hitCircle);
    if (combo_number !== null && number_alpha > 0) {
      this.drawComboNumber(center, combo_number, diameter, number_alpha, write);
    }
    addCentered(diameter * circle_scale, [1, 1, 1, alpha], this.skin.hitCircleOverlay);
    addCentered(diameter * approach_scale, [combo[0], combo[1], combo[2], approach_alpha], this.skin.approachCircle);
  }

  private drawSliderEndCircle(viewport: OsuViewport, position: { x: number; y: number }, diameter: number,
    alpha: number, combo: readonly [number, number, number, number], write: SpriteQuadWriter): void {
    const center = viewport.playfieldToScreen(position);
    const circle = this.skin.sliderEndCircle ?? this.skin.hitCircle;
    const overlay = this.skin.sliderEndCircle === undefined
      ? this.skin.hitCircleOverlay
      : this.skin.sliderEndCircleOverlay;
    write(center.x - diameter / 2, center.y - diameter / 2, diameter, diameter,
      [combo[0], combo[1], combo[2], alpha], circle);
    if (overlay) write(center.x - diameter / 2, center.y - diameter / 2, diameter, diameter,
      [1, 1, 1, alpha], overlay);
  }

  private drawComboNumber(center: { x: number; y: number }, combo_number: number, diameter: number, alpha: number,
    write: SpriteQuadWriter): void {
    const digits = String(combo_number).split("").map((digit) => this.skin.hitCircleGlyphs?.[digit]).filter(Boolean);
    if (digits.length === 0) return;
    const scale = diameter / OSU_HIT_OBJECT_TEXTURE_SIZE * 0.8;
    const overlap = this.skin.hitCircleOverlap ?? -2;
    const width = digits.reduce((total, digit, index) => total + digit!.sourceSize.w - (index > 0 ? overlap : 0), 0) * scale;
    const height = digits[0]!.sourceSize.h * scale;
    let x = center.x - width / 2;
    for (const [index, digit] of digits.entries()) {
      if (index > 0) x -= overlap * scale;
      const digit_width = digit!.sourceSize.w * scale;
      write(x, center.y - height / 2, digit_width, digit!.sourceSize.h * scale, [1, 1, 1, alpha], digit!);
      x += digit_width;
    }
  }

  private comboColor(chart: OsuChart, index: number): readonly [number, number, number, number] {
    const colors = (chart.combo_colors?.length ?? 0) > 0 ? chart.combo_colors : this.skin.comboColors ?? [this.skin.comboColor];
    return colors[index % colors.length] ?? this.skin.comboColor;
  }

  private drawJudgment(viewport: OsuViewport, center: { x: number; y: number }, judgment: string,
    age: number, gamefield_scale: number, write: SpriteQuadWriter): void {
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
    const width = sprite.sourceSize.w * gamefield_scale * scale;
    const height = sprite.sourceSize.h * gamefield_scale * scale;
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
