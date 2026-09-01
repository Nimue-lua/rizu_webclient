import type { OsuChart } from "../../../chart/Chart";
import type { OsuStandardSkin } from "../../../noteskin/osu/OsuSkin";

export const CIRCLE_FADE_IN = 0.4;
export const APPROACH_FADE_IN = 0.8;
export const HIT_FADE_OUT = 0.24;
export const MISS_FADE_OUT = 0.06;
export const OSU_HIT_OBJECT_TEXTURE_SIZE = 128;

export type OsuColor = readonly [number, number, number, number];

export function comboColor(skin: OsuStandardSkin, chart: OsuChart, index: number): OsuColor {
  const colors = (chart.combo_colors?.length ?? 0) > 0
    ? chart.combo_colors
    : skin.comboColors ?? [skin.comboColor];
  return colors[index % colors.length] ?? skin.comboColor;
}
