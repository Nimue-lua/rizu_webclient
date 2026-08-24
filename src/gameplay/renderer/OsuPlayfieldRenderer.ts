import type { OsuChart } from "../../chart/Chart";
import type { OsuStandardSkin } from "./OsuSkin";
import type { SpriteQuadWriter } from "./Sprite";

export const OSU_STAGE_WIDTH = 640;
export const OSU_STAGE_HEIGHT = 480;
const PLAYFIELD_LEFT = 64;
const PLAYFIELD_TOP = 48;
const CIRCLE_FADE_IN = 0.4;
const APPROACH_FADE_IN = 0.8;

export interface OsuLayout {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly left: number;
  readonly top: number;
}

export function approachPreempt(approach_rate: number): number {
  return approach_rate < 5 ? 1.8 - 0.12 * approach_rate : 1.2 - 0.15 * (approach_rate - 5);
}

export function circleDiameter(circle_size: number): number {
  return 108.8 - 8.96 * circle_size;
}

export class OsuPlayfieldRenderer {
  constructor(private readonly skin: OsuStandardSkin) {}

  getLayout(width: number, height: number): OsuLayout {
    const scale = Math.min(1, width / OSU_STAGE_WIDTH, height / OSU_STAGE_HEIGHT);
    return {
      width,
      height,
      scale,
      left: (width - OSU_STAGE_WIDTH * scale) / 2,
      top: (height - OSU_STAGE_HEIGHT * scale) / 2,
    };
  }

  draw(layout: OsuLayout, chart: OsuChart, song_time: number, write: SpriteQuadWriter): void {
    const preempt = approachPreempt(chart.approach_rate);
    const diameter = circleDiameter(chart.circle_size) * layout.scale;
    for (let index = chart.circles.length - 1; index >= 0; index -= 1) {
      const circle = chart.circles[index]!;
      const remaining = circle.absolute_time - song_time;
      if (remaining < 0 || remaining > preempt) continue;
      const age = preempt - remaining;
      const circle_alpha = Math.min(1, age / CIRCLE_FADE_IN);
      const approach_alpha = Math.min(0.9, age / Math.min(preempt, APPROACH_FADE_IN) * 0.9);
      const approach_scale = 1 + 3 * remaining / preempt;
      const center_x = layout.left + (PLAYFIELD_LEFT + circle.x) * layout.scale;
      const center_y = layout.top + (PLAYFIELD_TOP + circle.y) * layout.scale;
      const addCentered = (size: number, color: readonly [number, number, number, number], sprite: OsuStandardSkin["hitCircle"]) =>
        write(center_x - size / 2, center_y - size / 2, size, size, color, sprite);
      const combo = this.skin.comboColor;
      addCentered(diameter, [combo[0], combo[1], combo[2], circle_alpha], this.skin.hitCircle);
      addCentered(diameter, [1, 1, 1, circle_alpha], this.skin.hitCircleOverlay);
      addCentered(diameter * approach_scale, [combo[0], combo[1], combo[2], approach_alpha], this.skin.approachCircle);
    }
  }
}
