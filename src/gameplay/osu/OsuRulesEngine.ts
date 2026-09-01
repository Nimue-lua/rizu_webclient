import type { OsuChart, OsuSlider, OsuSpinner } from "../../chart/Chart";
import { osuApproachPreempt, osuCircleHitRadius } from "./OsuCircleGeometry";
import type { OsuCircleTransient } from "./OsuCirclePresentation";
import { OsuCircleState } from "./OsuCircleState";
import { createOsuSliderPaths, OsuSliderPath } from "./OsuSliderPath";
import type { OsuSliderPresentationState, OsuSpinnerPresentationState } from "./OsuSliderPresentation";
import type { OsuStandardJudgmentEvent } from "./OsuStandardJudgmentEvent";
import type { Point } from "./OsuViewport";
import { ScoreEngine } from "../scoring/ScoreEngine";
import type { ScoreResult } from "../scoring/ScoreResult";
import { classifyOsuStandardJudgment, OsuStandardScore } from "./scoring/OsuStandardScore";
import type { OsuStandardTimingValues } from "./timing/OsuStandardOdTimings";

export type OsuClickOutcome = "hit" | "miss" | "locked" | "too-early" | "spatial-miss";

interface SliderScorePoint {
  readonly time: number;
  readonly kind: "tick" | "repeat" | "tail";
}

interface ActiveSlider {
  readonly index: number;
  readonly slider: OsuSlider;
  readonly path: OsuSliderPath;
  readonly points: readonly SliderScorePoint[];
  next_point: number;
  successful_parts: number;
  tracking: boolean;
  tracking_started_at: number | null;
  readonly head_resolved_at: number;
  readonly head_successful: boolean;
}

interface ActiveSpinner {
  readonly index: number;
  readonly spinner: OsuSpinner;
  required_rotations: number;
  rotations: number;
  last_angle: number | null;
  last_sample_time: number | null;
  last_rpm_update_time: number;
  accumulated_angle: number;
  display_angle: number;
  rpm: number;
  judged: boolean;
}

const STABLE_HITTABLE_RANGE = 0.4;
const SLIDER_FOLLOW_RADIUS_MULTIPLIER = 2.4;
const SLIDER_TAIL_LENIENCE = 0.036;
const BOUNDARY_EPSILON = 1e-9;
const TRANSIENT_LIFETIME = 1.1;
const SPINNER_CENTER = { x: 256, y: 192 };
const SPINNER_RPM_DECAY_PER_FRAME = 0.9;
const SPINNER_MAX_RPM = 0.05 * 1000 / (Math.PI * 2) * 60;
const SPINNER_FADE_IN = 0.4;
const SPINNER_FADE_OUT = 0.24;

export class OsuRulesEngine {
  readonly object_states: Uint8Array;
  /** Kept as an alias for callers written before sliders became playable. */
  readonly circle_states: Uint8Array;
  readonly judgment_events: OsuStandardJudgmentEvent[] = [];
  readonly circle_transients: OsuCircleTransient[] = [];
  private readonly score_engine: ScoreEngine<OsuStandardJudgmentEvent>;
  private readonly hit_radius: number;
  private readonly hit_radius_squared: number;
  private readonly active_sliders: ActiveSlider[] = [];
  private active_spinner: ActiveSpinner | null = null;
  private cursor: Point = { x: 256, y: 192 };
  private action_pressed = false;
  private next_timeout_index = 0;

  constructor(private readonly chart: OsuChart, private readonly timings: OsuStandardTimingValues,
    difficulty_multiplier: number,
    private readonly slider_paths: ReadonlyMap<OsuSlider, OsuSliderPath> = createOsuSliderPaths(chart)) {
    this.object_states = new Uint8Array(chart.hit_objects.length);
    this.circle_states = this.object_states;
    this.score_engine = new ScoreEngine([new OsuStandardScore(timings, difficulty_multiplier)]);
    this.hit_radius = osuCircleHitRadius(chart.circle_size);
    this.hit_radius_squared = this.hit_radius * this.hit_radius;
  }

  get score(): ScoreResult { return this.score_engine.getResult(); }
  get first_active_circle_index(): number { return this.next_timeout_index; }

  get slider_state(): OsuSliderPresentationState | null {
    const active = this.active_sliders[0];
    if (!active) return null;
    return {
      object_index: active.index,
      position: this.sliderPosition(active, this.current_time),
      active: true,
      tracking: active.tracking,
      tracking_started_at: active.tracking_started_at,
      head_resolved_at: active.head_resolved_at,
      head_successful: active.head_successful,
    };
  }

  get slider_states(): readonly OsuSliderPresentationState[] {
    return this.active_sliders.map((active) => ({
      object_index: active.index,
      position: this.sliderPosition(active, this.current_time),
      active: true,
      tracking: active.tracking,
      tracking_started_at: active.tracking_started_at,
      head_resolved_at: active.head_resolved_at,
      head_successful: active.head_successful,
    }));
  }

  get spinner_state(): OsuSpinnerPresentationState | null {
    const active = this.active_spinner;
    if (!active) return null;
    const duration = active.spinner.end_time - active.spinner.absolute_time;
    const fade_in_progress = Math.min(1, Math.max(0,
      (this.current_time - (active.spinner.absolute_time - SPINNER_FADE_IN)) / SPINNER_FADE_IN));
    const fade_out_progress = Math.min(1, Math.max(0,
      (this.current_time - active.spinner.end_time) / SPINNER_FADE_OUT));
    return {
      object_index: active.index,
      progress: Math.min(1, active.rotations / Math.max(1, active.required_rotations)),
      duration_progress: duration <= 0 ? 1
        : Math.min(1, Math.max(0, (this.current_time - active.spinner.absolute_time) / duration)),
      rotation_radians: active.display_angle,
      rpm: active.rpm,
      opacity: fade_in_progress * (1 - fade_out_progress),
      fade_in_progress,
      active: true,
    };
  }

  private current_time = Number.NEGATIVE_INFINITY;

  setInput(x: number, y: number, action_pressed: boolean, song_time: number): void {
    this.advanceTo(song_time);
    this.cursor = { x, y };
    this.action_pressed = action_pressed;
    this.updateActiveTracking(song_time);
  }

  update(song_time: number): void {
    this.advanceTo(song_time);
    this.updateActiveTracking(song_time);
  }

  private advanceTo(song_time: number): void {
    this.current_time = song_time;
    this.pruneTransients(song_time);
    this.updateSlider(song_time);
    this.updateSpinner(song_time);
    while (this.next_timeout_index < this.chart.hit_objects.length) {
      const index = this.next_timeout_index;
      const object = this.chart.hit_objects[index]!;
      if (object.kind === "spinner") {
        if (song_time < object.absolute_time - SPINNER_FADE_IN) break;
        this.next_timeout_index += 1;
        if (this.object_states[index] === OsuCircleState.Pending) this.startSpinner(index, object);
        continue;
      }
      if (song_time <= object.absolute_time + this.timings.late_miss) break;
      this.next_timeout_index += 1;
      if (this.object_states[index] !== OsuCircleState.Pending) continue;
      if (object.kind === "circle") {
        this.resolveCircle(index, OsuCircleState.Missed, {
          kind: "miss", object_index: index, time: object.absolute_time + this.timings.late_miss,
        }, song_time);
      } else {
        this.resolveSliderHead(index, object, object.absolute_time + this.timings.late_miss, 0, false, song_time);
      }
    }
  }

  private updateActiveTracking(song_time: number): void {
    for (const active of this.active_sliders) this.updateSliderTracking(active, song_time);
    if (this.active_spinner && !this.action_pressed) {
      this.active_spinner.last_angle = null;
      this.active_spinner.last_sample_time = null;
    }
  }

  click(x: number, y: number, song_time: number): OsuClickOutcome {
    this.cursor = { x, y };
    this.update(song_time);
    const candidate = this.findCandidate(x, y, song_time);
    if (candidate === undefined) return this.isBeforeAppearance(x, y, song_time) ? "too-early" : "spatial-miss";

    const object = this.chart.hit_objects[candidate]!;
    const first_live = this.findFirstLive(song_time);
    if (first_live !== undefined && first_live !== candidate &&
      this.chart.hit_objects[first_live]!.absolute_time < object.absolute_time) {
      this.shake(candidate, song_time);
      return "locked";
    }

    const delta_time = this.snapTimingDelta(song_time - object.absolute_time);
    if (Math.abs(delta_time) >= STABLE_HITTABLE_RANGE) {
      this.shake(candidate, song_time);
      return "too-early";
    }

    const successful = Math.abs(delta_time) < this.timings.hit_50;
    if (object.kind === "circle") {
      this.resolveCircle(candidate, successful ? OsuCircleState.Hit : OsuCircleState.Missed, {
        kind: "hit", object_index: candidate, time: song_time, delta_time,
      }, song_time);
    } else if (object.kind === "slider") {
      this.resolveSliderHead(candidate, object, song_time, delta_time, successful, song_time);
    }
    return successful ? "hit" : "miss";
  }

  private resolveSliderHead(index: number, slider: OsuSlider, time: number, delta_time: number,
    successful: boolean, presentation_time: number): void {
    this.object_states[index] = successful ? OsuCircleState.Hit : OsuCircleState.Missed;
    this.emit({ kind: "slider-head", object_index: index, time, delta_time, successful });
    if (!successful && Number.isFinite(presentation_time)) {
      this.circle_transients.push({ kind: "miss", object_index: index, start_time: presentation_time,
        position: { x: slider.x, y: slider.y } });
    }
    const active: ActiveSlider = {
      index, slider, path: this.slider_paths.get(slider)!, points: this.sliderScorePoints(slider),
      next_point: 0, successful_parts: successful ? 1 : 0, tracking: false,
      tracking_started_at: null, head_resolved_at: time, head_successful: successful,
    };
    this.active_sliders.push(active);
    this.updateSliderTracking(active, time);
  }

  private updateSlider(song_time: number): void {
    for (let index = 0; index < this.active_sliders.length;) {
      const active = this.active_sliders[index]!;
      this.updateSliderTracking(active, song_time);
      while (active.next_point < active.points.length && active.points[active.next_point]!.time <= song_time + BOUNDARY_EPSILON) {
        const point = active.points[active.next_point++]!;
        const successful = active.tracking;
        if (successful) active.successful_parts += 1;
        this.emit({ kind: "slider-point", point_kind: point.kind, object_index: active.index,
          time: point.time, successful });
      }
      if (active.next_point < active.points.length || song_time < active.slider.end_time) {
        index += 1;
        continue;
      }
      const event = { kind: "slider-end" as const, object_index: active.index, time: active.slider.end_time,
        successful_parts: active.successful_parts, total_parts: active.points.length + 1 };
      this.emit(event);
      if (Number.isFinite(song_time)) {
        const judgment = classifyOsuStandardJudgment(this.timings, event);
        const position = active.path.endPosition(active.slider.repeat_count);
        this.circle_transients.push(judgment === "miss"
          ? { kind: "miss", object_index: active.index, start_time: song_time, position }
          : { kind: "hit", object_index: active.index, start_time: song_time, judgment, position });
      }
      this.active_sliders.splice(index, 1);
    }
  }

  private updateSliderTracking(active: ActiveSlider, song_time: number): void {
    if (song_time < active.slider.absolute_time) {
      active.tracking = false;
      active.tracking_started_at = null;
      return;
    }
    const was_tracking = active.tracking;
    const radius = this.hit_radius * (active.tracking ? SLIDER_FOLLOW_RADIUS_MULTIPLIER : 1);
    active.tracking = this.action_pressed && distanceSquared(this.cursor, this.sliderPosition(active, song_time)) < radius * radius;
    if (active.tracking && !was_tracking) active.tracking_started_at = song_time;
    else if (!active.tracking) active.tracking_started_at = null;
  }

  private sliderPosition(active: ActiveSlider, song_time: number): Point {
    const slider = active.slider;
    if (slider.span_duration <= 0) return { x: slider.x, y: slider.y };
    const elapsed = Math.min(Math.max(song_time - slider.absolute_time, 0), slider.total_duration);
    const span = Math.min(slider.repeat_count - 1, Math.floor(elapsed / slider.span_duration));
    const local = Math.min(1, Math.max(0, (elapsed - span * slider.span_duration) / slider.span_duration));
    return active.path.positionAtProgress(span % 2 === 0 ? local : 1 - local);
  }

  private sliderScorePoints(slider: OsuSlider): SliderScorePoint[] {
    const points: SliderScorePoint[] = [];
    if (slider.span_duration <= 0) return [{ time: slider.absolute_time, kind: "tail" }];
    for (let span = 0; span < slider.repeat_count; span += 1) {
      for (const distance of slider.tick_distances) {
        const progress = slider.pixel_length > 0 ? distance / slider.pixel_length : 0;
        const traversal = span % 2 === 0 ? progress : 1 - progress;
        points.push({ time: slider.absolute_time + (span + traversal) * slider.span_duration, kind: "tick" });
      }
      if (span < slider.repeat_count - 1) {
        points.push({ time: slider.absolute_time + (span + 1) * slider.span_duration, kind: "repeat" });
      }
    }
    const tail_time = Math.max(slider.absolute_time + slider.total_duration / 2,
      slider.end_time - SLIDER_TAIL_LENIENCE);
    points.push({ time: tail_time, kind: "tail" });
    return points.sort((left, right) => left.time - right.time);
  }

  private startSpinner(index: number, spinner: OsuSpinner): void {
    const overall_difficulty = this.chart.overall_difficulty ?? 5;
    const ratio = overall_difficulty > 5 ? 5 + (overall_difficulty - 5) * 0.5 : 3 + overall_difficulty * 0.4;
    this.active_spinner = { index, spinner, required_rotations: Math.floor((spinner.end_time - spinner.absolute_time) * ratio),
      rotations: 0, last_angle: null, last_sample_time: null, last_rpm_update_time: spinner.absolute_time,
      accumulated_angle: 0, display_angle: 0, rpm: 0, judged: false };
  }

  private updateSpinner(song_time: number): void {
    const active = this.active_spinner;
    if (!active) return;
    if (song_time > active.last_rpm_update_time) {
      active.rpm *= Math.pow(SPINNER_RPM_DECAY_PER_FRAME, (song_time - active.last_rpm_update_time) * 60);
      active.last_rpm_update_time = song_time;
    }
    if (song_time >= active.spinner.absolute_time && song_time < active.spinner.end_time && this.action_pressed) {
      const angle = Math.atan2(this.cursor.y - SPINNER_CENTER.y, this.cursor.x - SPINNER_CENTER.x);
      if (active.last_angle !== null) {
        let difference = angle - active.last_angle;
        if (difference > Math.PI) difference -= Math.PI * 2;
        else if (difference < -Math.PI) difference += Math.PI * 2;
        if (Math.abs(difference) < Math.PI) {
          active.accumulated_angle += Math.abs(difference);
          active.display_angle += difference;
          if (active.last_sample_time !== null && song_time > active.last_sample_time) {
            const instantaneous_rpm = Math.min(SPINNER_MAX_RPM,
              Math.abs(difference) / (song_time - active.last_sample_time) / (Math.PI * 2) * 60);
            active.rpm = active.rpm * SPINNER_RPM_DECAY_PER_FRAME + instantaneous_rpm * (1 - SPINNER_RPM_DECAY_PER_FRAME);
          }
        }
      }
      active.last_angle = angle;
      active.last_sample_time = song_time;
      const rotations = Math.floor(active.accumulated_angle / Math.PI);
      while (active.rotations < rotations) {
        active.rotations += 1;
        const bonus = active.rotations > active.required_rotations + 3 &&
          (active.rotations - (active.required_rotations + 3)) % 2 === 0;
        if (bonus || active.rotations > 1 && active.rotations % 2 === 0) {
          this.emit({ kind: "spinner-spin", object_index: active.index, time: song_time, bonus });
        }
      }
    } else if (song_time < active.spinner.absolute_time || !this.action_pressed) {
      active.last_angle = null;
      active.last_sample_time = null;
    }
    if (song_time < active.spinner.end_time) return;
    if (!active.judged) {
      active.judged = true;
      this.object_states[active.index] = active.rotations >= active.required_rotations ? OsuCircleState.Hit : OsuCircleState.Missed;
      this.emit({ kind: "spinner-end", object_index: active.index, time: active.spinner.end_time,
        rotations: active.rotations, required_rotations: active.required_rotations });
    }
    if (song_time >= active.spinner.end_time + SPINNER_FADE_OUT) this.active_spinner = null;
  }

  private findCandidate(x: number, y: number, song_time: number): number | undefined {
    const preempt = osuApproachPreempt(this.chart.approach_rate);
    const end = this.upperBound(song_time + preempt);
    for (let index = this.next_timeout_index; index < end; index += 1) {
      const object = this.chart.hit_objects[index]!;
      if (object.kind === "spinner") continue;
      if (this.object_states[index] !== OsuCircleState.Pending || song_time < object.absolute_time - preempt ||
        song_time > object.absolute_time + this.timings.hit_50) continue;
      if (distanceSquared({ x, y }, object) <= this.hit_radius_squared + BOUNDARY_EPSILON) return index;
    }
    return undefined;
  }

  private findFirstLive(song_time: number): number | undefined {
    for (let index = this.next_timeout_index; index < this.chart.hit_objects.length; index += 1) {
      const object = this.chart.hit_objects[index]!;
      if (object.kind === "spinner") continue;
      if (this.object_states[index] === OsuCircleState.Pending && object.absolute_time + this.timings.hit_50 > song_time) return index;
    }
    return undefined;
  }

  private isBeforeAppearance(x: number, y: number, song_time: number): boolean {
    const preempt = osuApproachPreempt(this.chart.approach_rate);
    const start = this.upperBound(song_time + preempt);
    for (let index = start; index < this.chart.hit_objects.length; index += 1) {
      const object = this.chart.hit_objects[index]!;
      if (object.kind === "spinner" || this.object_states[index] !== OsuCircleState.Pending ||
        song_time >= object.absolute_time - preempt) continue;
      if (distanceSquared({ x, y }, object) <= this.hit_radius_squared + BOUNDARY_EPSILON) return true;
    }
    return false;
  }

  private resolveCircle(index: number, state: OsuCircleState, event: OsuStandardJudgmentEvent,
    presentation_time: number): void {
    this.object_states[index] = state;
    this.emit(event);
    if (!Number.isFinite(presentation_time)) return;
    const judgment = classifyOsuStandardJudgment(this.timings, event);
    this.circle_transients.push(judgment === "miss"
      ? { kind: "miss", object_index: index, start_time: presentation_time }
      : { kind: "hit", object_index: index, start_time: presentation_time, judgment });
  }

  private emit(event: OsuStandardJudgmentEvent): void {
    this.judgment_events.push(event);
    this.score_engine.receive(event);
  }

  private shake(index: number, song_time: number): void {
    const previous = this.circle_transients.findIndex((transient) => transient.kind === "shake" && transient.object_index === index);
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
    for (const boundary of [this.timings.hit_300, this.timings.hit_100, this.timings.hit_50, STABLE_HITTABLE_RANGE]) {
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

function distanceSquared(first: Point, second: Point): number {
  const x = first.x - second.x;
  const y = first.y - second.y;
  return x * x + y * y;
}
