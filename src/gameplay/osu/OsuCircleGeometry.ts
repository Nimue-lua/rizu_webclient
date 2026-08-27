export function osuCircleDiameter(circle_size: number): number {
  return 108.8 - 8.96 * circle_size;
}

export function osuApproachPreempt(approach_rate: number): number {
  return approach_rate < 5 ? 1.8 - 0.12 * approach_rate : 1.2 - 0.15 * (approach_rate - 5);
}

export function osuCircleHitRadius(circle_size: number): number {
  // Stable includes this allowance for legacy gamefield rounding.
  return osuCircleDiameter(circle_size) / 2 * 1.00041;
}
