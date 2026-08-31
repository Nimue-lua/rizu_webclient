import type { OsuChart, OsuHitObject } from "../../../chart/Chart";

function distance(left: OsuHitObject, right: OsuHitObject): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

export interface OsuDifficultyAttributes {
  difficulty: number;
  speed: number;
  dexterity: number;
  stamina: number;
  technical: number;
}

function hardestAverage(strains: number[]): number {
  if (strains.length === 0) return 0;
  strains.sort((left, right) => right - left);
  const hardest_count = Math.max(1, Math.ceil(strains.length * 0.2));
  return strains.slice(0, hardest_count).reduce((sum, strain) => sum + strain, 0) / hardest_count;
}

function scaleSkill(strain: number): number {
  const curved_limit = 10 ** 1.8;
  return strain <= 10 ? strain ** 1.8 : curved_limit + (strain - 10) * 2;
}

function aggregateSkills(skills: readonly number[]): number {
  return skills.reduce((sum, skill) => sum + skill ** 6, 0) ** (1 / 6);
}

function movementDifficulty(section_rates: ReadonlyMap<number, number>): number {
  const peak = (window: number) => {
    let maximum = 0;
    for (const index of section_rates.keys()) {
      let sum = 0;
      for (let offset = 0; offset < window; offset += 1) sum += section_rates.get(index - offset) ?? 0;
      maximum = Math.max(maximum, sum / window);
    }
    return maximum;
  };
  const peak_strain = (peak(4) * 0.35 + peak(10) * 0.45 + peak(20) * 0.2) / 1000;
  const sustained_load = [...section_rates.values()].reduce((sum, rate) => sum + Math.max(0, rate - 800) / 1000, 0);
  return (peak_strain + Math.sqrt(sustained_load) * 0.05) * 1.7;
}

export function calculateOsuDifficultyAttributes(
  chart: Pick<OsuChart, "end_time" | "hit_objects">,
): OsuDifficultyAttributes {
  const objects = chart.hit_objects.filter((object) => object.kind !== "spinner");
  if (objects.length === 0) return { difficulty: 0, speed: 0, dexterity: 0, stamina: 0, technical: 0 };

  const speed_strains: number[] = [];
  const stamina_strains: number[] = [];
  const technical_strains: number[] = [];
  const aim_sync_strains: number[] = [];
  const first_time = objects[0]!.absolute_time;
  const movement_sections = new Map<number, number>();
  let previous_delta = 0;
  let previous_angle = 0;
  let stamina_seconds = 0;
  let spaced_stream_length = 0;
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
    let turn_angle = 0;
    let angle_technical = 0;
    const earlier = objects[index - 2];
    if (earlier) {
      const incoming_x = previous.x - earlier.x;
      const incoming_y = previous.y - earlier.y;
      const outgoing_x = object.x - previous.x;
      const outgoing_y = object.y - previous.y;
      const incoming_distance = Math.hypot(incoming_x, incoming_y);
      if (incoming_distance > 0 && spacing > 0) {
        const cosine = Math.max(-1, Math.min(1,
          (incoming_x * outgoing_x + incoming_y * outgoing_y) / (incoming_distance * spacing)));
        turn_angle = Math.acos(cosine);
        const angle_factor = Math.sin(turn_angle);
        const unpredictability = Math.min(Math.abs(turn_angle - previous_angle) / (Math.PI / 2), 1);
        angle_technical = Math.min((Math.min(incoming_distance, spacing) / 150) * speed * angle_factor * unpredictability, 3);
      }
    }
    if (delta <= 500) {
      const awkwardness = 1 + Math.sin(turn_angle) * 0.2;
      const section = Math.floor((object.absolute_time - first_time) / 0.5);
      movement_sections.set(section, (movement_sections.get(section) ?? 0) + spacing * awkwardness * 2);
    }
    const stream = delta <= 200 && spacing <= 140
      ? speed * 0.75 * (1 + Math.min(spacing / 120, 1) * 0.6)
      : 0;
    if (delta >= 30_000) stamina_seconds = 0;
    else if (delta > 200) stamina_seconds *= 10 ** (-delta / 5000);
    if (stream > 0) stamina_seconds = Math.min(120, stamina_seconds + delta / 1000);
    const stamina = stream > 0 ? Math.sqrt(Math.min(stamina_seconds, 10) / 10) * stream * 1.5 : 0;
    if (delta <= 200) speed_strains.push(speed * 1.5);
    spaced_stream_length = delta > 120
      ? 0
      : spacing >= 70
        ? Math.min(12, spaced_stream_length + 1)
        : Math.max(0, spaced_stream_length - 1);
    const aim_sync = jump * Math.min(spaced_stream_length / 12, 1) * 2.8;
    if (aim_sync > 0) aim_sync_strains.push(aim_sync);
    if (stamina > 0) stamina_strains.push(stamina);
    const transition_technical = rhythm * Math.sqrt(speed) + angle_technical + aim_sync;
    if (transition_technical > 0) technical_strains.push(transition_technical);
    previous_delta = delta;
    previous_angle = turn_angle;
  }

  for (const object of objects) {
    if (object.kind !== "slider") continue;
    const slider_length = Math.max(0, object.pixel_length);
    const span_duration_ms = object.span_duration * 1000;
    const slider_speed = span_duration_ms > 0 ? slider_length / span_duration_ms : 0;
    const slider_technical = slider_speed
      * (1.2 + Math.min(Math.sqrt(slider_length / 100) * 0.35, 1.5))
      * (1 + Math.max(0, object.repeat_count - 1) * 0.25);
    if (slider_technical > 0) technical_strains.push(slider_technical);
  }

  const duration = Math.max(0, chart.end_time - (chart.hit_objects[0]?.absolute_time ?? 0));
  const length_multiplier = duration < 35 ? 0.8 : duration < 60 ? 0.85 : duration < 120 ? 0.95 : 1;
  const speed = scaleSkill(hardestAverage(speed_strains) * length_multiplier);
  const dexterity = scaleSkill(movementDifficulty(movement_sections) * length_multiplier);
  const stamina = scaleSkill(hardestAverage(stamina_strains) * length_multiplier);
  const technical = scaleSkill(Math.max(hardestAverage(technical_strains), hardestAverage(aim_sync_strains)) * length_multiplier);
  return { difficulty: aggregateSkills([speed, dexterity, stamina, technical]), speed, dexterity, stamina, technical };
}

export function calculateOsuDifficulty(chart: Pick<OsuChart, "end_time" | "hit_objects">): number {
  return calculateOsuDifficultyAttributes(chart).difficulty;
}
