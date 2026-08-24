import type { AudioPlaybackPosition } from "./audio/AudioPlayback";

export interface AudioGameplayClockOptions {
  rate: number;
  music_offset_ms: number;
  sample_audio_position: () => AudioPlaybackPosition | null;
  performance_now?: () => number;
  correction_factor?: number;
  snap_threshold_seconds?: number;
}

export interface GameplayClockTime {
  monotonic: number;
  corrected: number;
}

const DEFAULT_CORRECTION_FACTOR = 0.1;
// Seek-sized drift should not spend several seconds converging at the native 10% correction rate.
const DEFAULT_SNAP_THRESHOLD_SECONDS = 0.25;

export class AudioGameplayClock {
  private readonly performance_now: () => number;
  private readonly sample_audio_position: () => AudioPlaybackPosition | null;
  private readonly correction_factor: number;
  private readonly snap_threshold_seconds: number;
  private anchor_performance_time = 0;
  private anchor_corrected_time = 0;
  private monotonic_floor = -Infinity;
  private last_audio_position: number | null = null;
  private rate: number;
  private music_offset_ms: number;
  private advancing = false;
  private correcting = false;
  private started = false;

  constructor(options: AudioGameplayClockOptions) {
    this.validateRate(options.rate);
    const correction_factor = options.correction_factor ?? DEFAULT_CORRECTION_FACTOR;
    if (correction_factor < 0 || correction_factor > 1) throw new RangeError("Correction factor must be between 0 and 1");
    const snap_threshold = options.snap_threshold_seconds ?? DEFAULT_SNAP_THRESHOLD_SECONDS;
    if (!Number.isFinite(snap_threshold) || snap_threshold <= 0) throw new RangeError("Snap threshold must be positive");
    this.rate = options.rate;
    this.music_offset_ms = options.music_offset_ms;
    this.performance_now = options.performance_now ?? (() => performance.now());
    this.sample_audio_position = options.sample_audio_position;
    this.correction_factor = correction_factor;
    this.snap_threshold_seconds = snap_threshold;
  }

  start(lead_in_seconds: number): void {
    if (this.started) throw new Error("Audio gameplay clock has already started");
    if (!Number.isFinite(lead_in_seconds) || lead_in_seconds < 0) throw new RangeError("Lead-in must not be negative");
    this.resetTimeline(this.performance_now(), -lead_in_seconds * this.rate + this.offsetTime());
    this.advancing = true;
    this.correcting = true;
    this.started = true;
  }

  timeAt(performance_time: number): GameplayClockTime {
    let corrected = this.extrapolate(performance_time);
    if (this.advancing && this.correcting) {
      const sample = this.sample_audio_position();
      if (sample && Number.isFinite(sample.position) && Number.isFinite(sample.performance_time) &&
        sample.position !== this.last_audio_position) {
        this.last_audio_position = sample.position;
        const audio_time = sample.position +
          (performance_time - sample.performance_time) / 1000 * this.rate + this.offsetTime();
        const drift = audio_time - corrected;
        corrected = Math.abs(drift) / this.rate >= this.snap_threshold_seconds
          ? audio_time
          : corrected + drift * this.correction_factor;
        this.anchor_performance_time = performance_time;
        this.anchor_corrected_time = corrected;
      }
    }
    this.monotonic_floor = Math.max(this.monotonic_floor, corrected);
    return { monotonic: this.monotonic_floor, corrected };
  }

  pause(): void {
    if (!this.advancing) return;
    const now = this.performance_now();
    this.anchor_corrected_time = this.timeAt(now).corrected;
    this.anchor_performance_time = now;
    this.advancing = false;
  }

  resume(): void {
    if (this.advancing) return;
    this.anchor_performance_time = this.performance_now();
    this.last_audio_position = null;
    this.advancing = true;
    this.correcting = true;
  }

  seek(gameplay_time: number): void {
    if (!Number.isFinite(gameplay_time)) throw new RangeError("Seek time must be finite");
    this.resetTimeline(this.performance_now(), gameplay_time);
  }

  restart(lead_in_seconds: number): void {
    if (!Number.isFinite(lead_in_seconds) || lead_in_seconds < 0) throw new RangeError("Lead-in must not be negative");
    this.seek(-lead_in_seconds * this.rate + this.offsetTime());
  }

  setRate(rate: number): void {
    this.validateRate(rate);
    if (rate === this.rate) return;
    const now = this.performance_now();
    const media_time = this.timeAt(now).corrected - this.offsetTime();
    this.rate = rate;
    this.resetTimeline(now, media_time + this.offsetTime());
  }

  setMusicOffset(music_offset_ms: number): void {
    if (!Number.isFinite(music_offset_ms)) throw new RangeError("Music offset must be finite");
    const now = this.performance_now();
    const media_time = this.timeAt(now).corrected - this.offsetTime();
    this.music_offset_ms = music_offset_ms;
    this.resetTimeline(now, media_time + this.offsetTime());
  }

  end(): void {
    this.last_audio_position = null;
    // Gameplay time continues so result delays still elapse after short audio files.
    this.advancing = true;
    this.correcting = false;
  }

  private extrapolate(performance_time: number): number {
    if (!this.advancing) return this.anchor_corrected_time;
    return this.anchor_corrected_time + (performance_time - this.anchor_performance_time) / 1000 * this.rate;
  }

  private offsetTime(): number {
    return this.music_offset_ms / 1000 * this.rate;
  }

  private resetTimeline(performance_time: number, gameplay_time: number): void {
    this.anchor_performance_time = performance_time;
    this.anchor_corrected_time = gameplay_time;
    this.monotonic_floor = gameplay_time;
    this.last_audio_position = null;
  }

  private validateRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) throw new RangeError("Music rate must be positive");
  }
}
