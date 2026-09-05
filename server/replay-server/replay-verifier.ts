import { inflateSync } from "node:zlib";
import type { ManiaChart, OsuChart } from "../../src/chart/Chart.ts";
import { parseOsuChart } from "../../src/chart/format/osu/OsuParser.ts";
import { ManiaRulesEngine } from "../../src/gameplay/mania/ManiaRulesEngine.ts";
import { applyOsuHitObjectStacking } from "../../src/gameplay/osu/OsuHitObjectStacking.ts";
import { OsuRulesEngine } from "../../src/gameplay/osu/OsuRulesEngine.ts";
import { calculateOsuStandardDifficultyMultiplier } from "../../src/gameplay/osu/scoring/OsuStandardDifficulty.ts";
import { resolveOsuStandardTimingValues } from "../../src/gameplay/timing/TimingValuesFactory.ts";
import { Timings } from "../../src/gameplay/timing/Timings.ts";
import { replayValue, type ManiaRecordedReplay, type OsuRecordedReplay } from "../../src/replay/RecordedReplay.ts";
import { ManiaReplayBase, type ManiaReplayBaseValues } from "../../src/replay/mania/ManiaReplayBase.ts";
import type { OsuReplayBaseValues } from "../../src/replay/osu/OsuReplayBase.ts";
import { ChartStore } from "./chart-store.ts";
import type { JsonObject, ReplayValidationResult, ReplayValidator } from "./types.ts";

const MAX_REPLAY_JSON_SIZE = 32 * 1024 * 1024;
const MAX_REPLAY_EVENTS = 2_000_000;
const MAX_EVENT_TICK = 24 * 60 * 60 * 8192;
const OSU_SAMPLE_RATE = 120;
const MAX_CHART_END_TIME = 4 * 60 * 60;
export const REPLAY_COMPUTE_VERSION = 3;
const REPLAY_TIME_EPSILON = 0.5 / 8192;

function object(value: unknown, name: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as JsonObject;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function integer(value: unknown, name: string): number {
  const result = finite(value, name);
  if (!Number.isSafeInteger(result)) throw new Error(`${name} must be an integer`);
  return result;
}

function eventTick(value: unknown): number {
  const tick = integer(value, "Replay event time");
  if (Math.abs(tick) > MAX_EVENT_TICK) throw new Error("Replay event time is out of range");
  return tick;
}

function commonBase(value: unknown, mode: "mania" | "osu"): JsonObject {
  const base = object(value, "Replay base");
  if (base.mode !== mode || !Array.isArray(base.modifiers) || base.modifiers.length !== 0 || base.custom !== false ||
    base.rate_type !== "linear") throw new Error("Replay uses unsupported rules");
  const rate = finite(base.rate, "Replay rate");
  if (rate < 0.25 || rate > 4) throw new Error("Replay rate is out of range");
  return base;
}

function decodeReplay(bytes: Uint8Array, mode: "mania" | "osu"): JsonObject {
  let data: Uint8Array;
  try {
    data = inflateSync(bytes, { maxOutputLength: MAX_REPLAY_JSON_SIZE });
  } catch {
    throw new Error("Replay compression is invalid");
  }
  if (data.length === 0 || data.length > MAX_REPLAY_JSON_SIZE) throw new Error("Decompressed replay is empty or too large");
  let replay: JsonObject;
  try {
    replay = object(JSON.parse(new TextDecoder().decode(data)), "Replay");
  } catch (reason) {
    if (reason instanceof Error && reason.message.startsWith("Replay ")) throw reason;
    throw new Error("Replay JSON is invalid");
  }
  if (replay.version !== 1 || replay.time_unit !== "1/8192 second" || replay.mode !== mode || !Array.isArray(replay.input_events)) {
    throw new Error("Replay version or mode is unsupported");
  }
  if (replay.input_events.length > MAX_REPLAY_EVENTS) throw new Error("Replay has too many input events");
  return replay;
}

function result(score: { score?: number; accuracy?: number; grade?: string; combo?: number; max_combo?: number;
  judges?: Readonly<Record<string, number>> }, music_rate: number): ReplayValidationResult {
  if (typeof score.accuracy !== "number" || !Number.isFinite(score.accuracy)) throw new Error("Replay did not produce accuracy");
  const judges = score.judges ?? {};
  return { score: score.score ?? 0, accuracy: score.accuracy, music_rate, grade: score.grade ?? null,
    combo: score.combo ?? null, max_combo: score.max_combo ?? null, misses: judges.miss ?? 0, judges };
}

function verifyMania(chart: ManiaChart, replay_value: JsonObject, base_value: unknown): ReplayValidationResult {
  const raw_base = commonBase(base_value, "mania");
  if (raw_base.healths !== null || raw_base.columns_order !== null) throw new Error("Replay uses unsupported mania rules");
  const base = new ManiaReplayBase();
  base.importReplayBase(raw_base as unknown as ManiaReplayBaseValues);
  const replay = replay_value as unknown as ManiaRecordedReplay;
  const engine = new ManiaRulesEngine(chart, base.nearest ? "nearest" : "earliest", base.rate, base.const,
    base.tap_only, { timings: base.timings, subtimings: base.subtimings });
  const caught_notes = new Set<number>();
  for (const unknown_event of replay.input_events) {
    const event = object(unknown_event, "Mania replay event");
    const tick = eventTick(event.time);
    const column = integer(event.column, "Replay column");
    if (column < 0 || column >= chart.column_count || typeof event.pressed !== "boolean") throw new Error("Mania replay event is invalid");
    const note_index = event.note_index === null ? null : integer(event.note_index, "Replay note index");
    const time = replayValue(tick);
    if (event.pressed) {
      const caught = engine.press(column, time) ?? null;
      if (caught !== note_index) throw new Error("Mania replay note linkage does not match the chart");
      if (caught !== null) caught_notes.add(caught);
    } else if (note_index !== null) {
      if (!caught_notes.delete(note_index)) throw new Error("Mania replay releases a note that was not caught");
      engine.release(note_index, time);
    }
  }
  engine.update(Number.POSITIVE_INFINITY, 0, 0);
  return result(engine.score, base.rate);
}

function equalOsuTiming(left: JsonObject, right: Record<string, number>): boolean {
  return Object.entries(right).every(([key, value]) => typeof left[key] === "number" && Math.abs(left[key] - value) < 1e-9);
}

function verifyOsu(parsed_chart: OsuChart, replay_value: JsonObject, base_value: unknown): ReplayValidationResult {
  const base = commonBase(base_value, "osu") as unknown as OsuReplayBaseValues;
  if (typeof base.x_flip !== "boolean" || typeof base.y_flip !== "boolean") throw new Error("Osu replay flips are invalid");
  for (const [name, value, minimum] of [["approach_rate", base.approach_rate, -10], ["circle_size", base.circle_size, 0],
    ["overall_difficulty", base.overall_difficulty, 0]] as const) {
    if (value !== null && (!Number.isFinite(value) || value < minimum || value > 12)) throw new Error(`Osu ${name} is invalid`);
  }
  const timings = resolveOsuStandardTimingValues(Timings.fromValue(base.timings)).values;
  if (!equalOsuTiming(object(base.timing_values, "Osu timing values"), timings as unknown as Record<string, number>)) {
    throw new Error("Osu timing values do not match the timing identity");
  }
  const chart = applyOsuHitObjectStacking(parsed_chart, base.approach_rate ?? parsed_chart.approach_rate,
    base.circle_size ?? parsed_chart.circle_size);
  if (!Number.isFinite(chart.end_time) || chart.end_time < 0 || chart.end_time > MAX_CHART_END_TIME) {
    throw new Error("Chart duration is unsupported");
  }
  const difficulty = calculateOsuStandardDifficultyMultiplier(chart.hp_drain_rate,
    base.overall_difficulty ?? chart.overall_difficulty ?? 5, base.circle_size ?? chart.circle_size,
    chart.object_count, chart.drain_length_seconds);
  const engine = new OsuRulesEngine(chart, timings, difficulty);
  const replay = replay_value as unknown as OsuRecordedReplay;
  const events = replay.input_events.map((unknown_event) => {
    const event = object(unknown_event, "Osu replay event");
    const time = eventTick(event.time);
    if (event.type === "aim") return { type: "aim" as const, time, x: finite(event.x, "Replay x"), y: finite(event.y, "Replay y") };
    if (event.type === "action" && (event.action === "primary" || event.action === "secondary") && typeof event.pressed === "boolean") {
      return { type: "action" as const, time, action: event.action as "primary" | "secondary", pressed: event.pressed };
    }
    throw new Error("Osu replay event is invalid");
  });
  const aims = events.filter((event): event is Extract<typeof event, { type: "aim" }> => event.type === "aim")
    .map((event) => ({ time: replayValue(event.time), x: replayValue(integer(event.x, "Replay x")), y: replayValue(integer(event.y, "Replay y")) }));
  const cursorAt = (time: number) => {
    if (aims.length === 0) return { x: 256, y: 192 };
    let low = 0;
    while (low + 1 < aims.length && aims[low + 1]!.time <= time) low++;
    const previous = aims[low]!;
    const next = aims[low + 1];
    if (!next || next.time <= previous.time) return { x: previous.x, y: previous.y };
    const progress = Math.max(0, Math.min(1, (time - previous.time) / (next.time - previous.time)));
    return { x: previous.x + (next.x - previous.x) * progress, y: previous.y + (next.y - previous.y) * progress };
  };
  const actions = { primary: false, secondary: false };
  const maximum_event_time = events.reduce((maximum, event) => Math.max(maximum, replayValue(event.time)), Number.NEGATIVE_INFINITY);
  if (maximum_event_time > chart.end_time + 1.2 * base.rate + REPLAY_TIME_EPSILON) {
    throw new Error("Replay continues after gameplay ends");
  }
  let event_index = 0;
  const initial_time = Math.min(0, events.length ? replayValue(events[0]!.time) : 0);
  const final_time = Math.max(chart.end_time + 1, maximum_event_time);
  for (let sample = 0; initial_time + sample / OSU_SAMPLE_RATE <= final_time; sample++) {
    const sample_time = initial_time + sample / OSU_SAMPLE_RATE;
    while (event_index < events.length && replayValue(events[event_index]!.time) <= sample_time) {
      const event = events[event_index++]!;
      const time = replayValue(event.time);
      const cursor = cursorAt(time);
      if (event.type === "action") {
        if (actions[event.action] === event.pressed) throw new Error("Osu replay contains a duplicate action transition");
        actions[event.action] = event.pressed;
      }
      engine.setInput(cursor.x, cursor.y, actions.primary || actions.secondary, time);
      if (event.type === "action" && event.pressed) engine.click(cursor.x, cursor.y, time);
    }
    const cursor = cursorAt(sample_time);
    engine.setInput(cursor.x, cursor.y, actions.primary || actions.secondary, sample_time);
    engine.update(sample_time);
  }
  engine.update(Number.POSITIVE_INFINITY);
  return result(engine.score, base.rate);
}

export function createReplayValidator(chart_store: ChartStore): ReplayValidator {
  return async ({ chart_md5, chart_index, mode, replay: replay_bytes, replay_base }) => {
    if (chart_index !== 1) throw new Error("The web verifier currently supports chart index 1 only");
    const chart_bytes = await chart_store.load(chart_md5, chart_index);
    const chart = parseOsuChart(new TextDecoder().decode(chart_bytes));
    if (chart.mode !== mode) throw new Error("Replay mode does not match downloaded chart");
    const replay = decodeReplay(replay_bytes, mode);
    return mode === "mania" ? verifyMania(chart as ManiaChart, replay, replay_base)
      : verifyOsu(chart as OsuChart, replay, replay_base);
  };
}
