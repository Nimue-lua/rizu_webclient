import type { OsuChart, OsuHitObject, OsuSlider } from "../../../chart/Chart";
import type { OsuStandardSkin } from "../../../noteskin/osu/OsuSkin";
import type { SpriteQuadWriter } from "../../renderer/Sprite";
import { osuApproachPreempt } from "../OsuCircleGeometry";
import type { OsuSliderPath } from "../OsuSliderPath";
import type { OsuViewport, Point } from "../OsuViewport";

const FOLLOW_POINT_DISTANCE = 32;
const FOLLOW_POINT_BASE_PREEMPT = 0.8;
const FOLLOW_POINT_BASE_FADE = 0.4;
const OSU_MIN_PREEMPT = 0.45;
const FOLLOW_POINT_WIDTH = 16;
const FOLLOW_POINT_HEIGHT = 22;

export function drawFollowPoints(skin: OsuStandardSkin, viewport: OsuViewport, chart: OsuChart,
  first_active_index: number, song_time: number, write: SpriteQuadWriter,
  slider_path?: (slider: OsuSlider) => OsuSliderPath | undefined): void {
  const frames = skin.followPointFrames ?? [];
  const placeholder = frames.length === 0;
  const fallback = skin.sprites?.__white;
  if (placeholder && !fallback) return;
  const object_preempt = osuApproachPreempt(chart.approach_rate);
  const timing_scale = Math.min(1, object_preempt / OSU_MIN_PREEMPT);
  const follow_preempt = FOLLOW_POINT_BASE_PREEMPT * timing_scale;
  const follow_fade = FOLLOW_POINT_BASE_FADE * timing_scale;
  const objects = chart.hit_objects;
  let future_index = 0;
  let future_high = objects.length;
  while (future_index < future_high) {
    const middle = (future_index + future_high) >>> 1;
    if (objects[middle]!.absolute_time <= song_time + follow_preempt) future_index = middle + 1;
    else future_high = middle;
  }
  const last_target = Math.min(objects.length - 1, future_index);
  for (let target_index = Math.max(1, first_active_index - 1); target_index <= last_target; target_index += 1) {
    const previous = objects[target_index - 1]!;
    const target = objects[target_index]!;
    if (target.new_combo || previous.kind === "spinner" || target.kind === "spinner") continue;
    const start = objectEndPosition(previous, slider_path);
    if (!start) continue;
    const distance_x = target.x - start.x;
    const distance_y = target.y - start.y;
    const distance = Math.floor(Math.hypot(distance_x, distance_y));
    const duration = target.absolute_time - objectEndTime(previous);
    const rotation = Math.atan2(distance_y * (viewport.y_flip ? -1 : 1), distance_x * (viewport.x_flip ? -1 : 1));
    for (let offset = FOLLOW_POINT_DISTANCE * 1.5; offset < distance - FOLLOW_POINT_DISTANCE; offset += FOLLOW_POINT_DISTANCE) {
      const fraction = offset / distance;
      const arrival_time = objectEndTime(previous) + fraction * duration;
      if (song_time < arrival_time - follow_preempt || song_time >= arrival_time + follow_fade) continue;
      const fade_in_progress = Math.min(1, (song_time - (arrival_time - follow_preempt)) / follow_fade);
      const fade_out_progress = Math.max(0, (song_time - arrival_time) / follow_fade);
      const alpha = Math.min(fade_in_progress, 1 - fade_out_progress);
      const movement_progress = 1 - (1 - fade_in_progress) * (1 - fade_in_progress);
      const animated_fraction = fraction - 0.1 * (1 - movement_progress);
      const frame_duration = skin.animationFramerate ? 1 / skin.animationFramerate : 1 / Math.max(1, frames.length);
      const frame_index = Math.floor((song_time - (arrival_time - follow_preempt)) / frame_duration) % Math.max(1, frames.length);
      const sprite = frames[frame_index] ?? fallback!;
      const center = viewport.playfieldToScreen({ x: start.x + animated_fraction * distance_x,
        y: start.y + animated_fraction * distance_y });
      const scale = 1.5 - 0.5 * movement_progress;
      const width = (placeholder ? FOLLOW_POINT_WIDTH : sprite.sourceSize.w) * viewport.scale * scale;
      const height = (placeholder ? FOLLOW_POINT_HEIGHT : sprite.sourceSize.h) * viewport.scale * scale;
      write(center.x - width / 2, center.y - height / 2, width, height, [1, 1, 1, alpha], sprite,
        false, undefined, false, rotation);
    }
  }
}

function objectEndTime(object: OsuHitObject): number {
  return object.kind === "circle" ? object.absolute_time : object.end_time;
}

function objectEndPosition(object: OsuHitObject,
  slider_path?: (slider: OsuSlider) => OsuSliderPath | undefined): Point | null {
  if (object.kind === "spinner") return null;
  if (object.kind === "circle") return object;
  return slider_path?.(object)?.endPosition(object.repeat_count) ?? null;
}
