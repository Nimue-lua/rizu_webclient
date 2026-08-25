import type { OsuChart } from "../chart/Chart";
import { osuApproachPreempt, osuCircleHitRadius } from "./OsuCircleGeometry";
import type { OsuCircleTransient } from "./OsuCirclePresentation";
import { OsuCircleState } from "./OsuCircleState";
import type { OsuStandardJudgmentEvent } from "./OsuStandardJudgmentEvent";
import { ScoreEngine } from "./scoring/ScoreEngine";
import type { ScoreResult } from "./scoring/ScoreResult";
import { classifyOsuStandardJudgment, OsuStandardScore } from "./scoring/systems/OsuStandardScore";
import type { OsuStandardTimingValues } from "./timing/OsuStandardOdTimings";

export type OsuClickOutcome = "hit" | "miss" | "locked" | "too-early" | "spatial-miss";

const STABLE_HITTABLE_RANGE = 0.4;
const BOUNDARY_EPSILON = 1e-9;
const TRANSIENT_LIFETIME = 1.1;

export class OsuRulesEngine {
  readonly circle_states: Uint8Array;
  readonly judgment_events: OsuStandardJudgmentEvent[] = [];
  readonly circle_transients: OsuCircleTransient[] = [];
  private readonly score_engine: ScoreEngine<OsuStandardJudgmentEvent>;
  private readonly hit_radius_squared: number;
  private next_timeout_index = 0;

  constructor(private readonly chart: OsuChart, private readonly timings: OsuStandardTimingValues,
    difficulty_multiplier: number) {
    this.circle_states = new Uint8Array(chart.hit_objects.length);
    this.score_engine = new ScoreEngine([new OsuStandardScore(timings, difficulty_multiplier)]);
    const hit_radius = osuCircleHitRadius(chart.circle_size);
    this.hit_radius_squared = hit_radius * hit_radius;
  }

  get score(): ScoreResult {
    return this.score_engine.getResult();
  }

  get first_active_circle_index(): number {
    return this.next_timeout_index;
  }

  update(song_time: number): void {
    this.pruneTransients(song_time);
    while (this.next_timeout_index < this.chart.hit_objects.length) {
      const index = this.next_timeout_index;
      const circle = this.chart.hit_objects[index]!;
      if (circle.kind !== "circle") {
        this.next_timeout_index += 1;
        continue;
      }
      if (song_time <= circle.absolute_time + this.timings.late_miss) break;
      this.next_timeout_index += 1;
      if (this.circle_states[index] === OsuCircleState.Pending) {
        this.resolve(index, OsuCircleState.Missed, {
          kind: "miss",
          object_index: index,
          time: circle.absolute_time + this.timings.late_miss,
        }, song_time);
      }
    }
  }

  click(x: number, y: number, song_time: number): OsuClickOutcome {
    this.update(song_time);
    const candidate = this.findCandidate(x, y, song_time);
    if (candidate === undefined) return this.isBeforeAppearance(x, y, song_time) ? "too-early" : "spatial-miss";

    const circle = this.chart.hit_objects[candidate]!;
    if (circle.kind !== "circle") throw new Error("Osu circle candidate has an invalid object type");
    const first_live = this.findFirstLive(song_time);
    if (first_live !== undefined && first_live !== candidate &&
      this.chart.hit_objects[first_live]!.absolute_time < circle.absolute_time) {
      this.shake(candidate, song_time);
      return "locked";
    }

    const delta_time = this.snapTimingDelta(song_time - circle.absolute_time);
    if (Math.abs(delta_time) >= STABLE_HITTABLE_RANGE) {
      this.shake(candidate, song_time);
      return "too-early";
    }

    const missed = Math.abs(delta_time) >= this.timings.hit_50;
    this.resolve(candidate, missed ? OsuCircleState.Missed : OsuCircleState.Hit, {
      kind: "hit",
      object_index: candidate,
      time: song_time,
      delta_time,
    }, song_time);
    return missed ? "miss" : "hit";
  }

  private findCandidate(x: number, y: number, song_time: number): number | undefined {
    const preempt = osuApproachPreempt(this.chart.approach_rate);
    const end = this.upperBound(song_time + preempt);
    for (let index = this.next_timeout_index; index < end; index += 1) {
      const circle = this.chart.hit_objects[index]!;
      if (circle.kind !== "circle") continue;
      if (this.circle_states[index] !== OsuCircleState.Pending ||
        song_time < circle.absolute_time - preempt ||
        song_time > circle.absolute_time + this.timings.hit_50) continue;
      const dx = x - circle.x;
      const dy = y - circle.y;
      if (dx * dx + dy * dy <= this.hit_radius_squared + BOUNDARY_EPSILON) return index;
    }
    return undefined;
  }

  private findFirstLive(song_time: number): number | undefined {
    for (let index = this.next_timeout_index; index < this.chart.hit_objects.length; index += 1) {
      const circle = this.chart.hit_objects[index]!;
      if (circle.kind !== "circle") continue;
      if (this.circle_states[index] === OsuCircleState.Pending &&
        circle.absolute_time + this.timings.hit_50 > song_time) return index;
    }
    return undefined;
  }

  private isBeforeAppearance(x: number, y: number, song_time: number): boolean {
    const preempt = osuApproachPreempt(this.chart.approach_rate);
    const start = this.upperBound(song_time + preempt);
    for (let index = start; index < this.chart.hit_objects.length; index += 1) {
      const circle = this.chart.hit_objects[index]!;
      if (circle.kind !== "circle") continue;
      if (this.circle_states[index] !== OsuCircleState.Pending ||
        song_time >= circle.absolute_time - preempt) continue;
      const dx = x - circle.x;
      const dy = y - circle.y;
      if (dx * dx + dy * dy <= this.hit_radius_squared + BOUNDARY_EPSILON) return true;
    }
    return false;
  }

  private resolve(index: number, state: OsuCircleState, event: OsuStandardJudgmentEvent,
    presentation_time: number): void {
    this.circle_states[index] = state;
    this.judgment_events.push(event);
    this.score_engine.receive(event);
    if (!Number.isFinite(presentation_time)) return;
    const judgment = classifyOsuStandardJudgment(this.timings, event);
    this.circle_transients.push(judgment === "miss"
      ? { kind: "miss", object_index: index, start_time: presentation_time }
      : { kind: "hit", object_index: index, start_time: presentation_time, judgment });
  }

  private shake(index: number, song_time: number): void {
    const previous = this.circle_transients.findIndex((transient) =>
      transient.kind === "shake" && transient.object_index === index);
    if (previous >= 0) this.circle_transients.splice(previous, 1);
    this.circle_transients.push({ kind: "shake", object_index: index, start_time: song_time });
  }

  private pruneTransients(song_time: number): void {
    for (let index = this.circle_transients.length - 1; index >= 0; index -= 1) {
      const transient = this.circle_transients[index]!;
      const lifetime = transient.kind === "shake" ? 0.12 : TRANSIENT_LIFETIME;
      if (song_time - transient.start_time >= lifetime - BOUNDARY_EPSILON) this.circle_transients.splice(index, 1);
    }
  }

  private snapTimingDelta(delta_time: number): number {
    const magnitude = Math.abs(delta_time);
    for (const boundary of [this.timings.hit_300, this.timings.hit_100, this.timings.hit_50,
      STABLE_HITTABLE_RANGE]) {
      if (Math.abs(magnitude - boundary) <= BOUNDARY_EPSILON) return Math.sign(delta_time) * boundary;
    }
    return delta_time;
  }

  private upperBound(absolute_time: number): number {
    let low = 0;
    let high = this.chart.hit_objects.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.chart.hit_objects[middle]!.absolute_time <= absolute_time) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}
