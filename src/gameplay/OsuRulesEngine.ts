import type { OsuChart } from "../chart/Chart";
import { osuApproachPreempt, osuCircleHitRadius } from "./OsuCircleGeometry";
import { OsuCircleState } from "./OsuCircleState";
import type { OsuStandardJudgmentEvent } from "./OsuStandardJudgmentEvent";
import { ScoreEngine } from "./scoring/ScoreEngine";
import type { ScoreResult } from "./scoring/ScoreResult";
import { OsuStandardScore } from "./scoring/systems/OsuStandardScore";
import type { OsuStandardTimingValues } from "./timing/OsuStandardOdTimings";

export type OsuClickOutcome = "hit" | "miss" | "locked" | "too-early" | "spatial-miss";

const STABLE_HITTABLE_RANGE = 0.4;
const BOUNDARY_EPSILON = 1e-9;

export class OsuRulesEngine {
  readonly circle_states: Uint8Array;
  readonly judgment_events: OsuStandardJudgmentEvent[] = [];
  private readonly score_engine: ScoreEngine<OsuStandardJudgmentEvent>;
  private readonly hit_radius_squared: number;
  private next_timeout_index = 0;

  constructor(private readonly chart: OsuChart, private readonly timings: OsuStandardTimingValues,
    difficulty_multiplier: number) {
    this.circle_states = new Uint8Array(chart.circles.length);
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
    while (this.next_timeout_index < this.chart.circles.length) {
      const index = this.next_timeout_index;
      const circle = this.chart.circles[index]!;
      if (song_time <= circle.absolute_time + this.timings.late_miss) break;
      this.next_timeout_index += 1;
      if (this.circle_states[index] === OsuCircleState.Pending) {
        this.resolve(index, OsuCircleState.Missed, {
          kind: "miss",
          object_index: index,
          time: circle.absolute_time + this.timings.late_miss,
        });
      }
    }
  }

  click(x: number, y: number, song_time: number): OsuClickOutcome {
    this.update(song_time);
    const candidate = this.findCandidate(x, y, song_time);
    if (candidate === undefined) return this.isBeforeAppearance(x, y, song_time) ? "too-early" : "spatial-miss";

    const circle = this.chart.circles[candidate]!;
    const first_live = this.findFirstLive(song_time);
    if (first_live !== undefined && first_live !== candidate &&
      this.chart.circles[first_live]!.absolute_time < circle.absolute_time) {
      return "locked";
    }

    const delta_time = this.snapTimingDelta(song_time - circle.absolute_time);
    if (Math.abs(delta_time) >= STABLE_HITTABLE_RANGE) return "too-early";

    const missed = Math.abs(delta_time) >= this.timings.hit_50;
    this.resolve(candidate, missed ? OsuCircleState.Missed : OsuCircleState.Hit, {
      kind: "hit",
      object_index: candidate,
      time: song_time,
      delta_time,
    });
    return missed ? "miss" : "hit";
  }

  private findCandidate(x: number, y: number, song_time: number): number | undefined {
    const preempt = osuApproachPreempt(this.chart.approach_rate);
    const end = this.upperBound(song_time + preempt);
    for (let index = this.next_timeout_index; index < end; index += 1) {
      const circle = this.chart.circles[index]!;
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
    for (let index = this.next_timeout_index; index < this.chart.circles.length; index += 1) {
      const circle = this.chart.circles[index]!;
      if (this.circle_states[index] === OsuCircleState.Pending &&
        circle.absolute_time + this.timings.hit_50 > song_time) return index;
    }
    return undefined;
  }

  private isBeforeAppearance(x: number, y: number, song_time: number): boolean {
    const preempt = osuApproachPreempt(this.chart.approach_rate);
    const start = this.upperBound(song_time + preempt);
    for (let index = start; index < this.chart.circles.length; index += 1) {
      const circle = this.chart.circles[index]!;
      if (this.circle_states[index] !== OsuCircleState.Pending ||
        song_time >= circle.absolute_time - preempt) continue;
      const dx = x - circle.x;
      const dy = y - circle.y;
      if (dx * dx + dy * dy <= this.hit_radius_squared + BOUNDARY_EPSILON) return true;
    }
    return false;
  }

  private resolve(index: number, state: OsuCircleState, event: OsuStandardJudgmentEvent): void {
    this.circle_states[index] = state;
    this.judgment_events.push(event);
    this.score_engine.receive(event);
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
    let high = this.chart.circles.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.chart.circles[middle]!.absolute_time <= absolute_time) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}
