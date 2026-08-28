import type { ManiaChart, OsuChart, OsuHitObject, OsuSlider } from "../chart/Chart";
import { replayTick, type ManiaRecordedInputEvent, type ManiaRecordedReplay,
  type OsuRecordedReplay } from "../replay/RecordedReplay";
import { OsuSliderPath } from "./osu/OsuSliderPath";

const SAMPLE_RATE = 120;
const SAMPLE_STEP = 1 / SAMPLE_RATE;

interface ManiaAutoplayNote {
  readonly column: number;
  readonly start_time: number;
  end_time?: number;
  index: number;
}

export function createManiaAutoplayReplay(chart: ManiaChart, tap_only: boolean): ManiaRecordedReplay {
  const linked_notes: ManiaAutoplayNote[] = [];
  const open_notes = Array.from({ length: chart.column_count }, () => [] as ManiaAutoplayNote[]);
  for (const event of chart.notes) {
    const column = event.column - 1;
    if (event.weight <= 0) {
      if (event.weight === 0) linked_notes.push({ column, start_time: event.absolute_time, index: -1 });
      else {
        const note = open_notes[column]?.pop();
        if (note) note.end_time = event.absolute_time;
      }
    } else {
      const note = { column, start_time: event.absolute_time, index: -1 };
      linked_notes.push(note);
      open_notes[column]?.push(note);
    }
  }
  linked_notes.sort((left, right) => left.start_time - right.start_time);
  linked_notes.forEach((note, index) => { note.index = index; });

  const events: Array<ManiaRecordedInputEvent & { priority: number; order: number }> = [];
  let order = 0;
  for (const note of linked_notes) {
    const time = replayTick(note.start_time);
    events.push({ time, column: note.column, pressed: true, note_index: note.index, delta_time: 0,
      priority: 1, order: order++ });
    if (tap_only || note.end_time === undefined) {
      events.push({ time, column: note.column, pressed: false, note_index: note.index, delta_time: null,
        priority: 2, order: order++ });
    } else {
      events.push({ time: replayTick(note.end_time), column: note.column, pressed: false,
        note_index: note.index, delta_time: 0, priority: 0, order: order++ });
    }
  }
  events.sort((left, right) => left.time - right.time || left.priority - right.priority || left.order - right.order);
  return { version: 1, mode: "mania", time_unit: "1/8192 second",
    input_events: events.map(({ priority: _priority, order: _order, ...event }) => event), logic_events: [] };
}

export function createOsuAutoplayReplay(chart: OsuChart): OsuRecordedReplay {
  const events: Array<OsuRecordedReplay["input_events"][number] & { order: number }> = [];
  let order = 0;
  let primary_holds = 0;
  const primary_releases = new Map<number, number>();
  const aim = (time: number, x: number, y: number) => {
    events.push({ type: "aim", time: replayTick(time), x: replayTick(x), y: replayTick(y), order: order++ });
  };
  const action = (time: number, action_name: "primary" | "secondary", pressed: boolean) => {
    events.push({ type: "action", time: replayTick(time), action: action_name, pressed, order: order++ });
  };

  for (const object of chart.hit_objects) {
    applyPrimaryReleases(object.absolute_time);
    aim(object.absolute_time, object.x, object.y);
    if (object.kind === "circle") {
      action(object.absolute_time, "secondary", true);
      action(object.absolute_time, "secondary", false);
      continue;
    }
    action(object.absolute_time, "primary", true);
    primary_holds += 1;
    primary_releases.set(replayTick(object.end_time), (primary_releases.get(replayTick(object.end_time)) ?? 0) + 1);
    if (object.kind === "slider") sampleSlider(object);
    else sampleSpinner(object);
  }
  for (const tick of [...primary_releases.keys()].sort((left, right) => left - right)) applyPrimaryReleases(tick / 8192);

  events.sort((left, right) => left.time - right.time || left.order - right.order);
  return { version: 1, mode: "osu", time_unit: "1/8192 second",
    input_events: events.map(({ order: _order, ...event }) => event), judgment_events: [] };

  function applyPrimaryReleases(time: number): void {
    const due_ticks = [...primary_releases.keys()].filter((tick) => tick <= replayTick(time)).sort((left, right) => left - right);
    for (const tick of due_ticks) {
      primary_holds -= primary_releases.get(tick)!;
      primary_releases.delete(tick);
      if (primary_holds === 0) action(tick / 8192, "primary", false);
    }
  }

  function sampleSlider(slider: OsuSlider): void {
    const path = OsuSliderPath.create(slider, chart.format_version);
    forSamples(slider, (time) => {
      const elapsed = Math.min(Math.max(time - slider.absolute_time, 0), slider.total_duration);
      const span = slider.span_duration <= 0 ? 0
        : Math.min(slider.repeat_count - 1, Math.floor(elapsed / slider.span_duration));
      const progress = slider.span_duration <= 0 ? 0
        : Math.min(1, Math.max(0, (elapsed - span * slider.span_duration) / slider.span_duration));
      const position = path.positionAtProgress(span % 2 === 0 ? progress : 1 - progress);
      aim(time, position.x, position.y);
    });
  }

  function sampleSpinner(spinner: Extract<OsuHitObject, { kind: "spinner" }>): void {
    forSamples(spinner, (time) => {
      const angle = (time - spinner.absolute_time) * Math.PI * 60;
      aim(time, 256 + Math.cos(angle) * 100, 192 + Math.sin(angle) * 100);
    });
  }
}

function forSamples(object: Exclude<OsuHitObject, { kind: "circle" }>, sample: (time: number) => void): void {
  for (let time = object.absolute_time + SAMPLE_STEP; time < object.end_time; time += SAMPLE_STEP) sample(time);
  sample(object.end_time);
}
