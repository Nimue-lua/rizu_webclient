export type ScrollSpeedType = "default" | "osu";

export const OSU_SCROLL_SPEED_FACTOR = 7 / 96;

export function scrollSpeedToDisplay(speed_type: ScrollSpeedType, canonical_speed: number): number {
  if (speed_type === "osu") {
    return Math.min(40, Math.max(1, Math.round(canonical_speed / OSU_SCROLL_SPEED_FACTOR)));
  }

  return Math.min(3, Math.max(0.05, canonical_speed));
}

export function scrollSpeedToCanonical(speed_type: ScrollSpeedType, display_speed: number): number {
  const canonical_speed = speed_type === "osu"
    ? Math.min(40, Math.max(1, display_speed)) * OSU_SCROLL_SPEED_FACTOR
    : display_speed;
  return Math.min(3, Math.max(0.05, canonical_speed));
}
