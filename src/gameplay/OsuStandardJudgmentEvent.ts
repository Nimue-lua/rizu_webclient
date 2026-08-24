export type OsuStandardJudgmentEvent = {
  readonly kind: "hit";
  readonly object_index: number;
  readonly time: number;
  readonly delta_time: number;
} | {
  readonly kind: "miss";
  readonly object_index: number;
  readonly time: number;
};
