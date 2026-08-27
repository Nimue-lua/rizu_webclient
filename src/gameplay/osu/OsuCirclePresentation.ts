import type { OsuStandardJudge } from "./scoring/OsuStandardScore";
import type { Point } from "./OsuViewport";

export type OsuCircleTransient = {
  readonly kind: "hit";
  readonly object_index: number;
  readonly start_time: number;
  readonly judgment: Exclude<OsuStandardJudge, "miss">;
  readonly position?: Point;
} | {
  readonly kind: "miss" | "shake";
  readonly object_index: number;
  readonly start_time: number;
  readonly position?: Point;
};
