import type { OsuChart } from "../../chart/Chart";
import { osuApproachPreempt, osuCircleDiameter } from "../OsuCircleGeometry";
import { OsuCircleState } from "../OsuCircleState";
import { OsuViewport } from "../OsuViewport";
import type { OsuStandardSkin } from "./OsuSkin";
import type { SpriteQuadWriter } from "./Sprite";

const CIRCLE_FADE_IN = 0.4;
const APPROACH_FADE_IN = 0.8;

export class OsuPlayfieldRenderer {
  constructor(private readonly skin: OsuStandardSkin) {}

  draw(viewport: OsuViewport, chart: OsuChart, circle_states: Uint8Array, first_active_index: number,
    song_time: number, write: SpriteQuadWriter): void {
    const preempt = osuApproachPreempt(chart.approach_rate);
    const diameter = osuCircleDiameter(chart.circle_size) * viewport.scale;
    let low = 0;
    let high = chart.circles.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (chart.circles[middle]!.absolute_time <= song_time + preempt) low = middle + 1;
      else high = middle;
    }
    for (let index = low - 1; index >= first_active_index; index -= 1) {
      const circle = chart.circles[index]!;
      if (circle_states[index] !== OsuCircleState.Pending) continue;
      const remaining = circle.absolute_time - song_time;
      if (remaining > preempt) continue;
      const age = preempt - remaining;
      const circle_alpha = Math.min(1, age / CIRCLE_FADE_IN);
      const approach_alpha = remaining > 0
        ? Math.min(0.9, age / Math.min(preempt, APPROACH_FADE_IN) * 0.9)
        : 0;
      const approach_scale = 1 + 3 * Math.max(0, remaining) / preempt;
      const center = viewport.playfieldToScreen(circle);
      const addCentered = (size: number, color: readonly [number, number, number, number], sprite: OsuStandardSkin["hitCircle"]) =>
        write(center.x - size / 2, center.y - size / 2, size, size, color, sprite);
      const combo = this.skin.comboColor;
      addCentered(diameter, [combo[0], combo[1], combo[2], circle_alpha], this.skin.hitCircle);
      addCentered(diameter, [1, 1, 1, circle_alpha], this.skin.hitCircleOverlay);
      addCentered(diameter * approach_scale, [combo[0], combo[1], combo[2], approach_alpha], this.skin.approachCircle);
    }
  }
}
