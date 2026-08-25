import type { OsuStandardJudge } from "./scoring/systems/OsuStandardScore";

export type OsuCircleTransient = {
  readonly kind: "hit";
  readonly object_index: number;
  readonly start_time: number;
  readonly judgment: Exclude<OsuStandardJudge, "miss">;
} | {
  readonly kind: "miss" | "shake";
  readonly object_index: number;
  readonly start_time: number;
};
