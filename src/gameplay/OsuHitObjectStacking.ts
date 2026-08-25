import type { OsuChart, OsuHitObject, OsuSlider } from "../chart/Chart";
import { osuApproachPreempt, osuCircleDiameter } from "./OsuCircleGeometry";
import { OsuSliderPath } from "./OsuSliderPath";
import type { Point } from "./OsuViewport";

const STACK_DISTANCE = 3;

function distance(first: Point, second: Point): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function endTime(object: OsuHitObject): number {
  return object.kind === "circle" ? object.absolute_time : object.end_time;
}

function sliderEndPosition(slider: OsuSlider, format_version: number): Point {
  return OsuSliderPath.create(slider, format_version).endPosition(slider.repeat_count);
}

function modernStackHeights(chart: OsuChart, threshold: number): Int32Array {
  const objects = chart.hit_objects;
  const heights = new Int32Array(objects.length);
  const end_positions = objects.map((object) => object.kind === "slider"
    ? sliderEndPosition(object, chart.format_version)
    : { x: object.x, y: object.y });

  for (let index = objects.length - 1; index > 0; index -= 1) {
    let previous_index = index;
    let current_index = index;
    let current = objects[index]!;
    if (heights[index] !== 0 || current.kind === "spinner") continue;

    if (current.kind === "circle") {
      while (--previous_index >= 0) {
        const previous = objects[previous_index]!;
        if (previous.kind === "spinner") continue;
        if (current.absolute_time - endTime(previous) > threshold) break;

        if (previous.kind === "slider" &&
          distance(end_positions[previous_index]!, current) < STACK_DISTANCE) {
          const offset = heights[current_index]! - heights[previous_index]! + 1;
          const slider_end = end_positions[previous_index]!;
          for (let stacked_index = previous_index + 1; stacked_index <= index; stacked_index += 1) {
            if (distance(slider_end, objects[stacked_index]!) < STACK_DISTANCE) heights[stacked_index]! -= offset;
          }
          break;
        }

        if (distance(previous, current) < STACK_DISTANCE) {
          heights[previous_index] = heights[current_index]! + 1;
          current_index = previous_index;
          current = previous;
        }
      }
    } else {
      while (--previous_index >= 0) {
        const previous = objects[previous_index]!;
        if (previous.kind === "spinner") continue;
        if (current.absolute_time - previous.absolute_time > threshold) break;
        if (distance(end_positions[previous_index]!, current) < STACK_DISTANCE) {
          heights[previous_index] = heights[current_index]! + 1;
          current_index = previous_index;
          current = previous;
        }
      }
    }
  }
  return heights;
}

function legacyStackHeights(chart: OsuChart, threshold: number, stack_offset: number): Int32Array {
  const objects = chart.hit_objects;
  const heights = new Int32Array(objects.length);
  const positions = objects.map((object) => ({ x: object.x, y: object.y }));
  const end_positions = objects.map((object) => object.kind === "slider"
    ? sliderEndPosition(object, chart.format_version)
    : { x: object.x, y: object.y });

  for (let index = 0; index < objects.length; index += 1) {
    const current = objects[index]!;
    let stack_end_time = endTime(current);
    if (heights[index] === 0 || current.kind === "slider") {
      let slider_stack = 0;
      for (let next_index = index + 1; next_index < objects.length; next_index += 1) {
        const next = objects[next_index]!;
        if (next.absolute_time - threshold > stack_end_time) break;
        if (distance(positions[next_index]!, positions[index]!) < STACK_DISTANCE) {
          heights[index]! += 1;
          stack_end_time = endTime(next);
        } else if (distance(positions[next_index]!, end_positions[index]!) < STACK_DISTANCE) {
          heights[next_index]! -= ++slider_stack;
          stack_end_time = endTime(next);
        }
      }
    }
    const offset = heights[index]! * stack_offset;
    positions[index] = { x: positions[index]!.x - offset, y: positions[index]!.y - offset };
    end_positions[index] = { x: end_positions[index]!.x - offset, y: end_positions[index]!.y - offset };
  }
  return heights;
}

function translate(object: OsuHitObject, offset: number): OsuHitObject {
  if (offset === 0) return object;
  if (object.kind !== "slider") return { ...object, x: object.x - offset, y: object.y - offset };
  return {
    ...object,
    x: object.x - offset,
    y: object.y - offset,
    control_points: object.control_points.map((point) => ({ x: point.x - offset, y: point.y - offset })),
  };
}

export function applyOsuHitObjectStacking(chart: OsuChart, approach_rate = chart.approach_rate,
  circle_size = chart.circle_size): OsuChart {
  const stack_offset = osuCircleDiameter(circle_size) / 20;
  const threshold = osuApproachPreempt(approach_rate) * (chart.stack_leniency ?? 0.7);
  const heights = chart.format_version > 5
    ? modernStackHeights(chart, threshold)
    : legacyStackHeights(chart, threshold, stack_offset);
  return {
    ...chart,
    approach_rate,
    circle_size,
    hit_objects: chart.hit_objects.map((object, index) => translate(object, heights[index]! * stack_offset)),
  };
}
