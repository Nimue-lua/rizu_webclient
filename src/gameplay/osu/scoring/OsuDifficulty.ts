import type { OsuChart, OsuHitObject } from "../../../chart/Chart";

function distance(left: OsuHitObject, right: OsuHitObject): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

export function calculateOsuDifficulty(chart: Pick<OsuChart, "end_time" | "hit_objects">): number {
  const objects = chart.hit_objects.filter((object) => object.kind !== "spinner");
  if (objects.length === 0) return 0;

  const strains: number[] = [];
  let previous_delta = 0;
  let stamina_seconds = 0;
  for (let index = 1; index < objects.length; index += 1) {
    const previous = objects[index - 1]!;
    const object = objects[index]!;
    const delta = (object.absolute_time - previous.absolute_time) * 1000;
    if (!(delta > 0)) continue;

    const spacing = distance(previous, object);
    const speed = 200 / Math.max(delta, 50);
    const rhythm = previous_delta > 0
      ? Math.min(Math.abs(Math.log2(delta / previous_delta)), 2) * 1.2
      : 0;
    const jump = Math.min((spacing / 150) * speed * 1.2, 5);
    let reversal = 0;
    const earlier = objects[index - 2];
    if (earlier) {
      const incoming_x = previous.x - earlier.x;
      const incoming_y = previous.y - earlier.y;
      const outgoing_x = object.x - previous.x;
      const outgoing_y = object.y - previous.y;
      const incoming_distance = Math.hypot(incoming_x, incoming_y);
      if (incoming_distance > 0 && spacing > 0) {
        const angle_factor = Math.max(0,
          -(incoming_x * outgoing_x + incoming_y * outgoing_y) / (incoming_distance * spacing));
        reversal = Math.min((Math.min(incoming_distance, spacing) / 150) * speed * angle_factor, 3);
      }
    }
    const stream = delta <= 200 && spacing <= 140
      ? speed * 0.75 * (1 + Math.min(spacing / 120, 1) * 0.6)
      : 0;
    if (delta >= 30_000) stamina_seconds = 0;
    else if (delta > 200) stamina_seconds *= 10 ** (-delta / 5000);
    if (stream > 0) stamina_seconds = Math.min(120, stamina_seconds + delta / 1000);
    const stamina = stream > 0 ? Math.sqrt(stamina_seconds / 120) * stream * 0.8 : 0;
    strains.push(rhythm + jump + reversal + stream + stamina);
    previous_delta = delta;
  }

  for (const object of objects) {
    if (object.kind !== "slider") continue;
    const slider_length = Math.max(0, object.pixel_length);
    const span_duration_ms = object.span_duration * 1000;
    const slider_speed = span_duration_ms > 0 ? slider_length / span_duration_ms : 0;
    strains.push(
      Math.sqrt(slider_length / 100) * 0.9
      + slider_speed * 0.9
      + Math.max(0, object.repeat_count - 1) * 0.35,
    );
  }

  const duration = Math.max(0, chart.end_time - (chart.hit_objects[0]?.absolute_time ?? 0));
  const length_multiplier = duration < 35 ? 0.8 : duration < 60 ? 0.85 : duration < 120 ? 0.95 : 1;
  if (strains.length === 0) return 0.5 * length_multiplier;
  strains.sort((left, right) => right - left);
  const hardest_count = Math.max(1, Math.ceil(strains.length * 0.2));
  const hardest_average = strains.slice(0, hardest_count)
    .reduce((sum, strain) => sum + strain, 0) / hardest_count;
  return (0.5 + hardest_average) * length_multiplier;
}
