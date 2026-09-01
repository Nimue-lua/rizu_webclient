import type { OsuSlider } from "../../../chart/Chart";
import type { OsuStandardSkin } from "../../../noteskin/osu/OsuSkin";
import type { SpriteQuadWriter } from "../../renderer/Sprite";
import type { OsuSliderPresentationState } from "../OsuSliderPresentation";
import type { OsuSliderPath } from "../OsuSliderPath";
import type { OsuViewport, Point } from "../OsuViewport";
import { drawCircle } from "./OsuCircleRenderer";
import { APPROACH_FADE_IN, CIRCLE_FADE_IN, HIT_FADE_OUT, MISS_FADE_OUT,
  OSU_HIT_OBJECT_TEXTURE_SIZE, type OsuColor } from "./OsuPlayfieldRenderShared";

export const SLIDER_FADE_OUT = 0.24;
const REVERSE_ARROW_FADE_IN = 0.15;
const REVERSE_ARROW_PULSE_DURATION = 0.3;
const FOLLOW_FADE_IN = 0.06;
const FOLLOW_SCALE_IN = 0.18;

export function drawSliderForeground(skin: OsuStandardSkin, viewport: OsuViewport, slider: OsuSlider,
  path: OsuSliderPath | undefined, slider_state: OsuSliderPresentationState | undefined,
  slider_states_available: boolean, circle_state_pending: boolean, song_time: number, preempt: number,
  diameter: number, combo: OsuColor,
  write: SpriteQuadWriter, draw_slider?: (slider: OsuSlider, path: OsuSliderPath, alpha: number,
    color: OsuColor) => void): void {
  const remaining = slider.absolute_time - song_time;
  const end_age = song_time - slider.end_time;
  if (end_age >= SLIDER_FADE_OUT) return;
  const age = preempt - remaining;
  const fade_in_alpha = Math.min(1, Math.max(0, age / CIRCLE_FADE_IN));
  const fade_out_alpha = end_age > 0 ? Math.max(0, 1 - end_age / SLIDER_FADE_OUT) : 1;
  const alpha = fade_in_alpha * fade_out_alpha;
  if (path) draw_slider?.(slider, path, alpha, combo);
  const endpoint = path?.endPosition(slider.repeat_count) ?? { x: slider.x, y: slider.y };
  drawSliderEndCircle(skin, viewport, endpoint, diameter, alpha, combo, write);
  const head_fade_duration = slider_state?.head_successful ? HIT_FADE_OUT : MISS_FADE_OUT;
  const head_alpha = slider_state
    ? Math.min(alpha, Math.max(0, 1 - (song_time - slider_state.head_resolved_at) / head_fade_duration))
    : slider_states_available && !circle_state_pending ? 0 : alpha;
  const head_hit_progress = slider_state?.head_successful
    ? Math.min(1, Math.max(0, (song_time - slider_state.head_resolved_at) / HIT_FADE_OUT)) : 0;
  const head_scale = 1 + 0.4 * (2 * head_hit_progress - head_hit_progress * head_hit_progress);
  const approach_alpha = remaining > 0 ? Math.min(0.9, age / Math.min(preempt, APPROACH_FADE_IN) * 0.9) : 0;
  const approach_scale = 1 + 3 * Math.max(0, remaining) / preempt;
  drawCircle(skin, viewport, slider, diameter, head_alpha, slider_state ? 0 : approach_alpha, approach_scale,
    combo, slider.combo_number, write, head_scale, slider_state?.head_successful ? 0 : head_alpha);
  if (path && slider.tick_distances.length > 0 && song_time < slider.end_time) {
    drawSliderTicks(skin, viewport, slider, path, song_time, diameter, alpha, preempt, write);
  }
  if (path && song_time >= slider.absolute_time && song_time <= slider.end_time) {
    drawSliderBall(skin, viewport, slider, path, song_time, diameter, write);
    if (slider_state?.tracking) drawSliderFollowCircle(skin, viewport, slider_state, song_time, diameter, write);
  }
  if (path && slider.repeat_count > 1 && song_time < slider.end_time) {
    drawReverseArrow(skin, viewport, slider, path, song_time, diameter, alpha, preempt, write);
  }
}

function drawSliderTicks(skin: OsuStandardSkin, viewport: OsuViewport, slider: OsuSlider, path: OsuSliderPath,
  song_time: number, circle_diameter: number, slider_alpha: number, preempt: number, write: SpriteQuadWriter): void {
  const sprite = skin.sliderTick;
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
    const first_appear = slider.absolute_time - preempt * 2 / 3 + (tick_time - slider.absolute_time) / 2;
    const appear_time = span_index === 0 ? first_appear : span_start + (tick_time - span_start) / 2 - 0.2;
    const tick_alpha = Math.min(1, Math.max(0, (song_time - appear_time) / 0.15));
    if (tick_alpha <= 0) continue;
    const center = viewport.playfieldToScreen(position);
    write(center.x - width / 2, center.y - height / 2, width, height, [1, 1, 1, slider_alpha * tick_alpha], sprite);
  }
}

function drawReverseArrow(skin: OsuStandardSkin, viewport: OsuViewport, slider: OsuSlider, path: OsuSliderPath,
  song_time: number, circle_diameter: number, slider_alpha: number, preempt: number, write: SpriteQuadWriter): void {
  const sprite = skin.reverseArrow;
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
  const appear_time = span_index === 0 ? slider.absolute_time - preempt * 2 / 3
    : slider.absolute_time + span_index * slider.span_duration;
  const fade_alpha = Math.min(1, Math.max(0, (song_time - appear_time) / REVERSE_ARROW_FADE_IN));
  if (song_time >= repeat_time || fade_alpha <= 0) return;
  const pulse_start = appear_time + Math.floor((song_time - appear_time) / REVERSE_ARROW_PULSE_DURATION) *
    REVERSE_ARROW_PULSE_DURATION;
  const pulse_duration = Math.min(REVERSE_ARROW_PULSE_DURATION, repeat_time - pulse_start);
  const pulse_progress = Math.min(1, Math.max(0, (song_time - pulse_start) / pulse_duration));
  const eased_progress = 2 * pulse_progress - pulse_progress * pulse_progress;
  const pulse_scale = 1.3 - 0.3 * eased_progress;
  const scale = circle_diameter / OSU_HIT_OBJECT_TEXTURE_SIZE * pulse_scale;
  const width = sprite.sourceSize.w * scale;
  const height = sprite.sourceSize.h * scale;
  write(center.x - width / 2, center.y - height / 2, width, height, [1, 1, 1, slider_alpha * fade_alpha], sprite,
    false, undefined, false, rotation);
}

function drawSliderBall(skin: OsuStandardSkin, viewport: OsuViewport, slider: OsuSlider, path: OsuSliderPath,
  song_time: number, circle_diameter: number, write: SpriteQuadWriter): void {
  const frames = skin.sliderBallFrames ?? [];
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
  const frame_index = span_index % 2 === 0 ? animation_frame % frames.length
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

function drawSliderFollowCircle(skin: OsuStandardSkin, viewport: OsuViewport, state: OsuSliderPresentationState,
  song_time: number, circle_diameter: number, write: SpriteQuadWriter): void {
  const sprite = skin.sliderFollowCircle;
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

function drawSliderEndCircle(skin: OsuStandardSkin, viewport: OsuViewport, position: Point, diameter: number,
  alpha: number, combo: OsuColor, write: SpriteQuadWriter): void {
  const center = viewport.playfieldToScreen(position);
  const circle = skin.sliderEndCircle ?? skin.hitCircle;
  const overlay = skin.sliderEndCircle === undefined ? skin.hitCircleOverlay : skin.sliderEndCircleOverlay;
  write(center.x - diameter / 2, center.y - diameter / 2, diameter, diameter,
    [combo[0], combo[1], combo[2], alpha], circle);
  if (overlay) write(center.x - diameter / 2, center.y - diameter / 2, diameter, diameter,
    [1, 1, 1, alpha], overlay);
}

function distanceSquared(first: Point, second: Point): number {
  const x = first.x - second.x;
  const y = first.y - second.y;
  return x * x + y * y;
}
