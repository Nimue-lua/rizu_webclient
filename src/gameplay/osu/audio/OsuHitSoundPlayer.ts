import type { OsuChart, OsuHitObject, OsuSliderEdgeSet } from "../../../chart/Chart";
import type { OsuStandardJudgmentEvent } from "../OsuStandardJudgmentEvent";
import type { OsuStandardSkin } from "../../renderer/OsuSkin";
import { classifyOsuStandardJudgment } from "../scoring/OsuStandardScore";
import type { OsuStandardTimingValues } from "../timing/OsuStandardOdTimings";

const SAMPLE_SETS: Readonly<Record<number, string>> = { 1: "normal", 2: "soft", 3: "drum" };
const SOUND_TYPES = [
  { flag: 1, name: "hitnormal", volume: 0.8 },
  { flag: 4, name: "hitfinish", volume: 1 },
  { flag: 2, name: "hitwhistle", volume: 0.85 },
  { flag: 8, name: "hitclap", volume: 0.85 },
] as const;

interface ResolvedHitSound {
  readonly name: string;
  readonly volume: number;
}

export class OsuHitSoundPlayer {
  private readonly active_sources = new Set<AudioBufferSourceNode>();

  constructor(private readonly audio_context: AudioContext, private readonly chart: OsuChart,
    private readonly skin: OsuStandardSkin, private readonly master_volume: number,
    private readonly timings: OsuStandardTimingValues) {}

  play(event: OsuStandardJudgmentEvent): void {
    const object = this.chart.hit_objects[event.object_index];
    if (!object || !this.isSuccessful(event)) return;
    for (const sound of this.resolve(event, object)) {
      const buffer = this.skin.hitSounds?.[sound.name];
      if (!buffer) continue;
      const source = this.audio_context.createBufferSource();
      const gain = this.audio_context.createGain();
      source.buffer = buffer;
      gain.gain.value = this.master_volume * sound.volume;
      source.connect(gain);
      gain.connect(this.audio_context.destination);
      source.onended = () => {
        this.active_sources.delete(source);
        source.disconnect();
        gain.disconnect();
      };
      this.active_sources.add(source);
      source.start();
    }
  }

  destroy(): void {
    for (const source of this.active_sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.active_sources.clear();
  }

  private resolve(event: OsuStandardJudgmentEvent, object: OsuHitObject): ResolvedHitSound[] {
    if (event.kind === "slider-point" && event.point_kind === "tick") {
      const set = this.resolveSet(object.hit_sample.normal_set, event.time);
      return [{ name: `${set}-slidertick`, volume: this.resolveVolume(object, event.time) }];
    }
    let mask = object.hit_sound;
    let normal_set = object.hit_sample.normal_set;
    let addition_set = object.hit_sample.addition_set;
    if (object.kind === "slider") {
      const edge = event.kind === "slider-head" ? 0 : object.repeat_count;
      const edge_index = event.kind === "slider-point" && event.point_kind === "repeat"
        ? Math.round((event.time - object.absolute_time) / object.span_duration) : edge;
      mask = object.edge_sounds[edge_index] ?? mask;
      const sets: OsuSliderEdgeSet = object.edge_sets[edge_index] ?? { normal_set, addition_set };
      normal_set = sets.normal_set || normal_set;
      addition_set = sets.addition_set || addition_set;
    }
    const resolved_normal_set = this.resolveSet(normal_set, event.time);
    const resolved_addition_set = addition_set === 0 ? resolved_normal_set : SAMPLE_SETS[addition_set] ?? "normal";
    const layered_mask = mask === 0 ? 1 : mask | (this.skin.layeredHitSounds ? 1 : 0);
    const volume = this.resolveVolume(object, event.time);
    return SOUND_TYPES.flatMap((sound) => layered_mask & sound.flag
      ? [{ name: `${sound.name === "hitnormal" ? resolved_normal_set : resolved_addition_set}-${sound.name}`,
        volume: volume * sound.volume }]
      : []);
  }

  private resolveSet(set: number, time: number): string {
    if (set !== 0) return SAMPLE_SETS[set] ?? "normal";
    return SAMPLE_SETS[this.activeTimingPoint(time)?.sample_set ?? this.chart.sample_set] ?? "normal";
  }

  private resolveVolume(object: OsuHitObject, time: number): number {
    const volume = object.hit_sample.volume || this.activeTimingPoint(time)?.volume || 100;
    return Math.max(volume, 8) / 100;
  }

  private activeTimingPoint(time: number): OsuChart["timing_points"][number] | undefined {
    let active: OsuChart["timing_points"][number] | undefined;
    for (const point of this.chart.timing_points) {
      if (point.absolute_time > time) break;
      active = point;
    }
    return active;
  }

  private isSuccessful(event: OsuStandardJudgmentEvent): boolean {
    if (event.kind === "hit") return classifyOsuStandardJudgment(this.timings, event) !== "miss";
    if (event.kind === "slider-head" || event.kind === "slider-point") return event.successful;
    return false;
  }
}
