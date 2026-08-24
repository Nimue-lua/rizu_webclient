import type { Chart, Note, OsuCircle } from "../../Chart";
import { createVisualPoints, type TimingChange } from "../../VisualTimeline";

interface OsuTimingPoint {
  offset: number;
  beat_length: number;
}

interface ParsedHitObject {
  x: number;
  y: number;
  type: number;
  start_time: number;
  end_time?: number;
}

function normalizeTimingPoints(points: OsuTimingPoint[]): TimingChange[] {
  points.sort((left, right) => left.offset - right.offset || right.beat_length - left.beat_length);
  const changes = new Map<number, TimingChange>();
  const red_offsets = new Set<number>();
  const green_offsets = new Set<number>();

  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index]!;
    const change = changes.get(point.offset) ?? { time: point.offset };
    if (point.beat_length > 0 && !red_offsets.has(point.offset)) {
      red_offsets.add(point.offset);
      change.bpm = Math.min(60000 / point.beat_length, 1_000_000);
    } else if (point.beat_length < 0 && !green_offsets.has(point.offset)) {
      green_offsets.add(point.offset);
      change.scroll_velocity = Math.min(Math.max(Math.abs(-100 / point.beat_length), 0.1), 10);
    }
    changes.set(point.offset, change);
  }

  for (const offset of red_offsets) {
    const change = changes.get(offset)!;
    change.scroll_velocity ??= 1;
  }
  return [...changes.values()].sort((left, right) => left.time - right.time);
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
  let section = "";
  let mode = 3;
  let circle_size: number | null = null;
  let overall_difficulty = 5;
  let approach_rate: number | null = null;
  const timing_points: OsuTimingPoint[] = [];
  const hit_objects: ParsedHitObject[] = [];

  for (const raw_line of source.split("\n")) {
    const line = raw_line.trim();
    if (line === "" || line.startsWith("//")) continue;

    const section_match = line.match(/^\[(.+)]$/);
    if (section_match) {
      section = section_match[1] ?? "";
      continue;
    }

    const property_match = line.match(/^([A-Za-z]+):\s?(.*)$/);
    if (property_match) {
      if (section === "General" && property_match[1] === "Mode") mode = Number(property_match[2]);
      if (section === "Difficulty" && property_match[1] === "CircleSize") {
        circle_size = Number(property_match[2]);
      }
      if (section === "Difficulty" && property_match[1] === "OverallDifficulty") {
        overall_difficulty = Number(property_match[2]);
      }
      if (section === "Difficulty" && property_match[1] === "ApproachRate") {
        approach_rate = Number(property_match[2]);
      }
      continue;
    }

    if (section === "TimingPoints") {
      const fields = line.split(",");
      const offset = Number(fields[0]) / 1000;
      const beat_length = Number(fields[1]);
      if (!Number.isFinite(offset) || !Number.isFinite(beat_length) || beat_length === 0) {
        throw new Error(`Invalid timing point: ${line}`);
      }
      timing_points.push({ offset, beat_length });
      continue;
    }

    if (section === "HitObjects") {
      const fields = line.split(",");
      const x = Number(fields[0]);
      const y = Number(fields[1]);
      const start_time = Number(fields[2]) / 1000;
      const type = Number(fields[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(start_time) || !Number.isInteger(type)) {
        throw new Error(`Invalid hit object: ${line}`);
      }

      const hit_object: ParsedHitObject = { x, y, type, start_time };
      if ((type & 128) !== 0) {
        const end_time = Number(fields[5]?.split(":", 1)[0]) / 1000;
        if (!Number.isFinite(end_time) || end_time < start_time) throw new Error(`Invalid hold note: ${line}`);
        hit_object.end_time = end_time;
      }
      hit_objects.push(hit_object);
    }
  }

  if (mode !== 0 && mode !== 3) throw new Error(`Unsupported osu mode: ${mode}`);
  if (circle_size === null || !Number.isFinite(circle_size) || circle_size <= 0 || circle_size > 10) {
    throw new Error("Chart has an invalid CircleSize");
  }
  if (!Number.isFinite(overall_difficulty) || overall_difficulty < 0 || overall_difficulty > 10) {
    throw new Error("Chart has an invalid OverallDifficulty");
  }
  approach_rate ??= overall_difficulty;
  if (!Number.isFinite(approach_rate) || approach_rate < 0 || approach_rate > 10) {
    throw new Error("Chart has an invalid ApproachRate");
  }

  const timing_changes = normalizeTimingPoints(timing_points);
  const last_time = hit_objects.reduce((last, object) => Math.max(last, object.end_time ?? object.start_time), 0);
  const primary_tempo = computePrimaryTempo(timing_changes, last_time);
  if (mode === 0) {
    const circles: OsuCircle[] = hit_objects
      .filter((object) => (object.type & 1) !== 0)
      .map((object) => ({ x: object.x, y: object.y, absolute_time: object.start_time }))
      .sort((left, right) => left.absolute_time - right.absolute_time);
    return {
      mode: "osu",
      approach_rate,
      circle_size,
      end_time: last_time,
      overall_difficulty,
      primary_tempo,
      circles,
    };
  }
  const key_count = Math.floor(circle_size);
  if (key_count <= 0) throw new Error("Chart has an invalid CircleSize");

  const notes: Note[] = [];
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
