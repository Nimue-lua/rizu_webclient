import type { ManiaChart } from "../../../chart/Chart";

interface ActionGroup {
  time: number;
  actions: number;
  hold_change: number;
  regular_notes: number;
  hold_starts: number;
  hold_ends: number;
}

export function calculateManiaDifficulty(chart: Pick<ManiaChart, "column_count" | "notes">): number {
  const groups: ActionGroup[] = [];
  for (const note of chart.notes) {
    const time = note.absolute_time * 1000;
    const group = groups.at(-1);
    if (group?.time === time) {
      group.actions += 1;
      group.hold_change += note.weight;
      group.regular_notes += note.weight === 0 ? 1 : 0;
      group.hold_starts += note.weight === 1 ? 1 : 0;
      group.hold_ends += note.weight === -1 ? 1 : 0;
    } else {
      groups.push({
        time,
        actions: 1,
        hold_change: note.weight,
        regular_notes: note.weight === 0 ? 1 : 0,
        hold_starts: note.weight === 1 ? 1 : 0,
        hold_ends: note.weight === -1 ? 1 : 0,
      });
    }
  }
  if (groups.length === 0) return 0;

  const strains: number[] = [];
  let active_holds = 0;
  let previous_delta = 0;
  let stamina_seconds = 0;
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]!;
    const delta = index > 0 ? group.time - groups[index - 1]!.time : 0;
    active_holds = Math.max(0, active_holds + group.hold_change);

    const chord = Math.max(0, group.actions - 1) * 0.45;
    if (!(delta > 0)) {
      strains.push(chord);
      continue;
    }

    const speed = 200 / Math.max(delta, 30);
    const rhythm = previous_delta > 0
      ? Math.min(Math.abs(Math.log2(delta / previous_delta)), 2) * 1.2
      : 0;
    const action_weight = Math.min(1,
      group.regular_notes + group.hold_starts * 0.7 + group.hold_ends * 0.25);
    const stream = delta <= 200 ? speed * action_weight * (1 + chord * 0.35) : 0;
    const regular_note_bonus = delta <= 200 && group.regular_notes > 0 ? speed * 0.6 : 0;
    if (delta >= 30_000) stamina_seconds = 0;
    else if (delta > 200) stamina_seconds *= 10 ** (-delta / 5000);
    if (stream > 0) stamina_seconds = Math.min(120, stamina_seconds + delta / 1000);
    const stamina = stream > 0 ? Math.sqrt(stamina_seconds / 120) * stream * 0.75 : 0;
    const hold_pressure = stream * Math.min(active_holds / Math.max(chart.column_count, 1), 1) * 0.25;
    strains.push(rhythm + chord + stream + regular_note_bonus + stamina + hold_pressure);
    previous_delta = delta;
  }

  const duration = Math.max(0, (groups.at(-1)!.time - groups[0]!.time) / 1000);
  const length_multiplier = duration < 35 ? 0.8 : duration < 60 ? 0.85 : duration < 120 ? 0.95 : 1;
  strains.sort((left, right) => right - left);
  const hardest_count = Math.max(1, Math.ceil(strains.length * 0.2));
  const hardest_average = strains.slice(0, hardest_count)
    .reduce((sum, strain) => sum + strain, 0) / hardest_count;
  return (0.5 + hardest_average) * length_multiplier;
}
