import type { Chart, ManiaNoteEvent, OsuHitObject, OsuHitSample, OsuSliderCurveType,
  OsuTimingPoint } from "../../Chart";
import { createVisualPoints, type TimingChange } from "../../VisualTimeline";

interface RawTimingPoint {
  offset: number;
  beat_length: number;
  uninherited: boolean;
  sample_set: number | null;
  sample_index: number;
  volume: number;
  source_index: number;
}

interface RawHitObject {
  x: number;
  y: number;
  type: number;
  hit_sound: number;
  start_time: number;
  end_time?: number;
  fields: readonly string[];
  source_index: number;
}

interface BreakPeriod {
  start_time: number;
  end_time: number;
}

function sortTimingPoints(points: RawTimingPoint[]): void {
  points.sort((left, right) => left.offset - right.offset || Number(right.uninherited) - Number(left.uninherited)
    || left.source_index - right.source_index);
}

function normalizeTimingChanges(points: readonly RawTimingPoint[]): TimingChange[] {
  const changes = new Map<number, TimingChange>();
  const red_offsets = new Set<number>();
  const green_offsets = new Set<number>();

  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index]!;
    const change = changes.get(point.offset) ?? { time: point.offset };
    if (point.uninherited && point.beat_length > 0 && !red_offsets.has(point.offset)) {
      red_offsets.add(point.offset);
      change.bpm = Math.min(60000 / point.beat_length, 1_000_000);
    } else if (!point.uninherited && !green_offsets.has(point.offset)) {
      green_offsets.add(point.offset);
      change.scroll_velocity = point.beat_length < 0
        ? Math.min(Math.max(Math.abs(-100 / point.beat_length), 0.1), 10)
        : 1;
    }
    changes.set(point.offset, change);
  }

  for (const offset of red_offsets) {
    const change = changes.get(offset)!;
    change.scroll_velocity ??= 1;
  }
  return [...changes.values()].sort((left, right) => left.time - right.time);
}

function normalizeOsuTimingPoints(points: readonly RawTimingPoint[], default_sample_set: number): OsuTimingPoint[] {
  return points.map((point) => ({
    absolute_time: point.offset,
    beat_length: point.beat_length / 1000,
    uninherited: point.uninherited,
    slider_velocity: !point.uninherited && point.beat_length < 0
      ? Math.min(Math.max(-100 / point.beat_length, 0.1), 10)
      : 1,
    sample_set: point.sample_set ?? default_sample_set,
    sample_index: point.sample_index,
    volume: point.volume,
  }));
}

function parseHitSample(value: string | undefined, line: string): OsuHitSample {
  const fields = (value ?? "").split(":");
  const values = fields.slice(0, 4).map((field) => field === "" || field === undefined ? 0 : Number(field));
  if (values.some((field) => !Number.isInteger(field) || field < 0)) throw new Error(`Invalid hit sample: ${line}`);
  return {
    normal_set: values[0] ?? 0,
    addition_set: values[1] ?? 0,
    index: values[2] ?? 0,
    volume: values[3] ?? 0,
    filename: fields.slice(4).join(":"),
  };
}

function parseEdgeSounds(value: string | undefined, count: number, hit_sound: number, line: string): number[] {
  const parsed = value ? value.split("|").map(Number) : [];
  if (parsed.some((sound) => !Number.isInteger(sound) || sound < 0)) throw new Error(`Invalid slider edge sounds: ${line}`);
  return Array.from({ length: count }, (_, index) => parsed[index] ?? hit_sound);
}

function parseEdgeSets(value: string | undefined, count: number, line: string): { normal_set: number; addition_set: number }[] {
  const parsed = value ? value.split("|").map((edge) => {
    const [normal_set = "0", addition_set = "0"] = edge.split(":");
    return { normal_set: Number(normal_set), addition_set: Number(addition_set) };
  }) : [];
  if (parsed.some((edge) => !Number.isInteger(edge.normal_set) || edge.normal_set < 0 ||
    !Number.isInteger(edge.addition_set) || edge.addition_set < 0)) {
    throw new Error(`Invalid slider edge sets: ${line}`);
  }
  return Array.from({ length: count }, (_, index) => parsed[index] ?? { normal_set: 0, addition_set: 0 });
}

function activeSliderTiming(points: readonly RawTimingPoint[], start_time: number): { beat_length: number; velocity: number } {
  let red_index = -1;
  let inherited_index = -1;
  for (let index = 0; index < points.length && points[index]!.offset <= start_time; index += 1) {
    if (points[index]!.uninherited) red_index = index;
    else inherited_index = index;
  }
  if (red_index < 0) red_index = points.findIndex((point) => point.uninherited && point.beat_length > 0);
  const red = points[red_index];
  const inherited = points[inherited_index];
  const velocity = inherited_index > red_index && inherited && inherited.beat_length < 0
    ? Math.min(Math.max(-100 / inherited.beat_length, 0.1), 10)
    : 1;
  return { beat_length: red?.beat_length && red.beat_length > 0 ? red.beat_length : 0, velocity };
}

const CURVE_TYPES: Readonly<Record<string, OsuSliderCurveType>> = {
  L: "linear", B: "bezier", P: "perfect", C: "catmull",
};

function normalizeStandardHitObject(object: RawHitObject, timing_points: readonly RawTimingPoint[],
  slider_multiplier: number, slider_tick_rate: number, format_version: number): OsuHitObject {
  const line = object.fields.join(",");
  const new_combo = (object.type & 4) !== 0;
  const common = { x: object.x, y: object.y, absolute_time: object.start_time, hit_sound: object.hit_sound,
    new_combo, combo_skip: new_combo ? object.type >>> 4 & 7 : 0, combo_number: null,
    combo_color_index: 0 };
  if ((object.type & 1) !== 0) {
    return { kind: "circle", ...common, hit_sample: parseHitSample(object.fields[5], line) };
  }
  if ((object.type & 2) !== 0) {
    const path_parts = (object.fields[5] ?? "").split("|");
    const curve_type = CURVE_TYPES[path_parts.shift() ?? ""];
    if (!curve_type) throw new Error(`Invalid slider path: ${line}`);
    const control_points = path_parts.map((point) => {
      const [raw_x, raw_y, ...extra] = point.split(":");
      const x = Number(raw_x);
      const y = Number(raw_y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || extra.length !== 0) throw new Error(`Invalid slider path: ${line}`);
      return { x, y };
    });
    const repeat_count = Number(object.fields[6]);
    const pixel_length = Number(object.fields[7]);
    if (!Number.isInteger(repeat_count) || repeat_count < 1 || repeat_count > 9000 ||
      !Number.isFinite(pixel_length) || pixel_length < 0) throw new Error(`Invalid slider: ${line}`);
    const timing = activeSliderTiming(timing_points, object.start_time);
    const exact_duration_ms = timing.beat_length > 0
      ? pixel_length * repeat_count * timing.beat_length / (slider_multiplier * 100 * timing.velocity)
      : 0;
    const end_time = Math.floor(object.start_time * 1000 + exact_duration_ms) / 1000;
    const total_duration = end_time - object.start_time;
    const velocity = total_duration > 0 ? pixel_length * repeat_count / total_duration : 0;
    const base_tick_distance = 100 * slider_multiplier / slider_tick_rate;
    const tick_distance = Math.min(pixel_length, format_version < 8
      ? base_tick_distance
      : base_tick_distance * timing.velocity);
    const tick_distances: number[] = [];
    if (tick_distance > 0 && velocity > 0) {
      for (let distance = tick_distance; distance <= pixel_length; distance += tick_distance) {
        if (pixel_length - distance <= velocity * 0.01) break;
        tick_distances.push(distance);
      }
    }
    return {
      kind: "slider", ...common, curve_type, control_points, repeat_count, pixel_length,
      edge_sounds: parseEdgeSounds(object.fields[8], repeat_count + 1, object.hit_sound, line),
      edge_sets: parseEdgeSets(object.fields[9], repeat_count + 1, line),
      hit_sample: parseHitSample(object.fields[10], line),
      span_duration: total_duration / repeat_count,
      total_duration,
      end_time,
      tick_distances,
    };
  }
  if ((object.type & 8) !== 0) {
    const end_time = Number(object.fields[5]) / 1000;
    if (!Number.isFinite(end_time) || end_time < object.start_time) throw new Error(`Invalid spinner: ${line}`);
    return { kind: "spinner", ...common, end_time, hit_sample: parseHitSample(object.fields[6], line) };
  }
  throw new Error(`Unsupported osu hit object: ${line}`);
}

function assignStandardCombos(objects: readonly OsuHitObject[], color_count: number,
  format_version: number, breaks: readonly BreakPeriod[]): OsuHitObject[] {
  let color_cursor = 0;
  let combo_number = 0;
  let force_new = false;
  let break_index = 0;
  return objects.map((object, object_index) => {
    while (break_index < breaks.length && breaks[break_index]!.end_time < object.absolute_time) {
      force_new = true;
      break_index += 1;
    }
    let assigned_number: number | null = null;
    if (object.kind === "spinner") {
      if (format_version <= 8 || object.new_combo) {
        if (format_version > 8 && object.new_combo) color_cursor += object.combo_skip;
        force_new = true;
      } else {
        // Stable's loader still starts a new combo after every parsed spinner.
        force_new = true;
      }
    } else if (force_new || object.new_combo || object_index === 0) {
      assigned_number = combo_number = 1;
      color_cursor += object.combo_skip + 1;
      force_new = false;
    } else {
      assigned_number = ++combo_number;
    }
    return { ...object, combo_number: assigned_number,
      combo_color_index: color_count > 0 ? color_cursor % color_count : color_cursor };
  });
}

function computePrimaryTempo(changes: readonly TimingChange[], last_time: number): number {
  const tempo_changes = changes.filter((change) => change.bpm !== undefined);
  if (tempo_changes.length === 0) return 120;

  const durations = new Map<number, number>();
  let segment_end = last_time;
  for (let index = tempo_changes.length - 1; index >= 0; index -= 1) {
    const change = tempo_changes[index]!;
    if (change.time >= segment_end) continue;
    const segment_start = index === 0 ? 0 : change.time;
    const bpm = change.bpm!;
    durations.set(bpm, (durations.get(bpm) ?? 0) + segment_end - segment_start);
    segment_end = change.time;
  }

  let primary_tempo = tempo_changes[0]!.bpm!;
  let longest_duration = -1;
  for (const [bpm, duration] of durations) {
    if (duration > longest_duration) {
      primary_tempo = bpm;
      longest_duration = duration;
    }
  }
  return primary_tempo;
}

export function parseOsuChart(source: string): Chart {
  const format_match = /^osu file format v(\d+)/.exec(source.replace(/^\uFEFF/, ""));
  const format_version = format_match ? Number(format_match[1]) : 14;
  let section = "";
  let mode = 3;
  let stack_leniency = 0.7;
  let circle_size: number | null = null;
  let overall_difficulty = 5;
  let hp_drain_rate = 5;
  let approach_rate: number | null = null;
  let slider_multiplier = 1.4;
  let slider_tick_rate = 1;
  let sample_set = 1;
  const combo_colors = new Map<number, readonly [number, number, number, number]>();
  const timing_points: RawTimingPoint[] = [];
  const hit_objects: RawHitObject[] = [];
  const breaks: BreakPeriod[] = [];

  for (const raw_line of source.split("\n")) {
    const line = raw_line.trim();
    if (line === "" || line.startsWith("//")) continue;

    const section_match = line.match(/^\[(.+)]$/);
    if (section_match) {
      section = section_match[1] ?? "";
      continue;
    }

    const property_match = line.match(/^([A-Za-z]+\d*):\s?(.*)$/);
    if (property_match) {
      if (section === "General" && property_match[1] === "Mode") mode = Number(property_match[2]);
      if (section === "General" && property_match[1] === "StackLeniency") {
        stack_leniency = Number(property_match[2]);
      }
      if (section === "General" && property_match[1] === "SampleSet") {
        sample_set = { normal: 1, soft: 2, drum: 3 }[property_match[2]!.toLowerCase()] ?? 1;
      }
      if (section === "Difficulty" && property_match[1] === "CircleSize") {
        circle_size = Number(property_match[2]);
      }
      if (section === "Difficulty" && property_match[1] === "OverallDifficulty") {
        overall_difficulty = Number(property_match[2]);
      }
      if (section === "Difficulty" && property_match[1] === "HPDrainRate") {
        hp_drain_rate = Number(property_match[2]);
      }
      if (section === "Difficulty" && property_match[1] === "ApproachRate") {
        approach_rate = Number(property_match[2]);
      }
      if (section === "Difficulty" && property_match[1] === "SliderMultiplier") {
        slider_multiplier = Number(property_match[2]);
      }
      if (section === "Difficulty" && property_match[1] === "SliderTickRate") {
        slider_tick_rate = Number(property_match[2]);
      }
      if (section === "Colours") {
        const combo_match = /^Combo([1-8])$/.exec(property_match[1]!);
        if (combo_match) {
          const values = property_match[2]!.split(",").map((value) => Number(value.trim()));
          if (values.length < 3 || values.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) {
            throw new Error(`Invalid combo color: ${line}`);
          }
          combo_colors.set(Number(combo_match[1]), [values[0]! / 255, values[1]! / 255, values[2]! / 255, 1]);
        }
      }
      continue;
    }

    if (section === "Events") {
      const fields = line.split(",");
      if (fields[0] === "2" || fields[0] === "Break") {
        const start_time = Number(fields[1]) / 1000;
        const end_time = Number(fields[2]) / 1000;
        if (!Number.isFinite(start_time) || !Number.isFinite(end_time) || end_time < start_time) {
          throw new Error(`Invalid break period: ${line}`);
        }
        breaks.push({ start_time, end_time });
      }
      continue;
    }

    if (section === "TimingPoints") {
      const fields = line.split(",");
      const offset = Number(fields[0]) / 1000;
      let beat_length = Number(fields[1]);
      const uninherited = fields[6] === undefined ? beat_length > 0 : Number(fields[6]) === 1;
      const raw_sample_set = fields[3] === undefined ? null : Number(fields[3]);
      const timing_sample_set = raw_sample_set === 0 ? 2 : raw_sample_set;
      const sample_index = fields[4] === undefined ? 0 : Number(fields[4]);
      const volume = fields[5] === undefined ? 100 : Number(fields[5]);
      // Stable treats a NaN inherited beat length as a neutral control point, which resets inherited SV to 1x.
      if (!uninherited && fields[1]?.toLowerCase() === "nan") beat_length = 0;
      if (!Number.isFinite(offset) || !Number.isFinite(beat_length) || beat_length === 0) {
        if (beat_length !== 0 || uninherited) throw new Error(`Invalid timing point: ${line}`);
      }
      if (timing_sample_set !== null && (!Number.isInteger(timing_sample_set) || timing_sample_set < 1 || timing_sample_set > 3) ||
        !Number.isInteger(sample_index) || sample_index < 0 || !Number.isFinite(volume) || volume < 0) {
        throw new Error(`Invalid timing point: ${line}`);
      }
      timing_points.push({ offset, beat_length, uninherited, sample_set: timing_sample_set,
        sample_index, volume, source_index: timing_points.length });
      continue;
    }

    if (section === "HitObjects") {
      const fields = line.split(",");
      const x = Number(fields[0]);
      const y = Number(fields[1]);
      const start_time = Number(fields[2]) / 1000;
      const type = Number(fields[3]);
      const hit_sound = Number(fields[4]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(start_time) || !Number.isInteger(type) ||
        !Number.isInteger(hit_sound) || hit_sound < 0) {
        throw new Error(`Invalid hit object: ${line}`);
      }

      const hit_object: RawHitObject = {
        x, y, type, hit_sound, start_time, fields, source_index: hit_objects.length,
      };
      if ((type & 128) !== 0) {
        const end_time = Number(fields[5]?.split(":", 1)[0]) / 1000;
        if (!Number.isFinite(end_time) || end_time < start_time) throw new Error(`Invalid hold note: ${line}`);
        hit_object.end_time = end_time;
      }
      hit_objects.push(hit_object);
    }
  }

  if (mode !== 0 && mode !== 3) throw new Error(`Unsupported osu mode: ${mode}`);
  if (!Number.isFinite(stack_leniency)) throw new Error("Chart has an invalid StackLeniency");
  stack_leniency = Math.min(Math.max(stack_leniency, 0), 1);
  if (circle_size === null || !Number.isFinite(circle_size) || circle_size <= 0 || circle_size > 10) {
    throw new Error("Chart has an invalid CircleSize");
  }
  if (!Number.isFinite(overall_difficulty) || overall_difficulty < 0 || overall_difficulty > 10) {
    throw new Error("Chart has an invalid OverallDifficulty");
  }
  if (!Number.isFinite(hp_drain_rate) || hp_drain_rate < 0 || hp_drain_rate > 10) {
    throw new Error("Chart has an invalid HPDrainRate");
  }
  if (!Number.isFinite(slider_multiplier) || slider_multiplier <= 0) {
    throw new Error("Chart has an invalid SliderMultiplier");
  }
  slider_multiplier = Math.min(Math.max(slider_multiplier, 0.4), 3.6);
  if (!Number.isFinite(slider_tick_rate) || slider_tick_rate <= 0) {
    throw new Error("Chart has an invalid SliderTickRate");
  }
  slider_tick_rate = Math.min(Math.max(slider_tick_rate, 0.5), 8);
  approach_rate ??= overall_difficulty;
  if (!Number.isFinite(approach_rate) || approach_rate < 0 || approach_rate > 10) {
    throw new Error("Chart has an invalid ApproachRate");
  }

  sortTimingPoints(timing_points);
  const timing_changes = normalizeTimingChanges(timing_points);
  const parsed_standard_hit_objects = mode === 0
    ? hit_objects.map((object) => normalizeStandardHitObject(object, timing_points, slider_multiplier,
      slider_tick_rate, format_version))
      .sort((left, right) => left.absolute_time - right.absolute_time)
    : [];
  const normalized_combo_colors = [...combo_colors.entries()].sort(([left], [right]) => left - right).map(([, color]) => color);
  const standard_hit_objects = assignStandardCombos(parsed_standard_hit_objects,
    normalized_combo_colors.length, format_version, breaks);
  const last_time = mode === 0
    ? standard_hit_objects.reduce((last, object) => Math.max(last, object.kind === "circle" ? object.absolute_time : object.end_time), 0)
    : hit_objects.reduce((last, object) => Math.max(last, object.end_time ?? object.start_time), 0);
  const first_time = hit_objects.reduce((first, object) => Math.min(first, object.start_time), Number.POSITIVE_INFINITY);
  const break_time = breaks.reduce((total, period) => total + Math.max(0,
    Math.min(period.end_time, last_time) - Math.max(period.start_time, Number.isFinite(first_time) ? first_time : 0)), 0);
  const drain_length_seconds = hit_objects.length === 0 ? 0 : Math.max(0, Math.trunc(last_time - first_time - break_time));
  const primary_tempo = computePrimaryTempo(timing_changes, last_time);
  if (mode === 0) {
    return {
      mode: "osu",
      format_version,
      stack_leniency,
      approach_rate,
      circle_size,
      end_time: last_time,
      overall_difficulty,
      hp_drain_rate,
      object_count: hit_objects.length,
      drain_length_seconds,
      primary_tempo,
      slider_multiplier,
      slider_tick_rate,
      sample_set,
      combo_colors: normalized_combo_colors,
      timing_points: normalizeOsuTimingPoints(timing_points, sample_set),
      hit_objects: standard_hit_objects,
    };
  }
  const key_count = Math.floor(circle_size);
  if (key_count <= 0) throw new Error("Chart has an invalid CircleSize");

  const notes: ManiaNoteEvent[] = [];
  for (const hit_object of hit_objects) {
    const column = Math.min(Math.max(Math.floor(hit_object.x / 512 * key_count + 1), 1), key_count);
    if (hit_object.end_time === undefined) {
      notes.push({ column, absolute_time: hit_object.start_time, weight: 0 });
    } else {
      notes.push({ column, absolute_time: hit_object.start_time, weight: 1 });
      notes.push({ column, absolute_time: hit_object.end_time, weight: -1 });
    }
  }
  notes.sort((left, right) => left.absolute_time - right.absolute_time);

  return {
    mode: "mania",
    column_count: key_count,
    overall_difficulty,
    primary_tempo,
    notes,
    visual_points: createVisualPoints(timing_changes, primary_tempo),
  };
}
