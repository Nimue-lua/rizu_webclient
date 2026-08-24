import type { AudioPlayback, AudioPlaybackPosition } from "./AudioPlayback";

interface WebAudioTimestamp {
  context_time: number;
  performance_time: number;
}

export interface WebAudioPlaybackOptions {
  audio_context: AudioContext;
  audio_buffer: AudioBuffer;
  volume: number;
  rate: number;
  performance_now?: () => number;
}

export class WebAudioPlayback implements AudioPlayback {
  private readonly audio_context: AudioContext;
  private readonly audio_buffer: AudioBuffer;
  private readonly performance_now: () => number;
  private readonly gain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private source_start_context_time = 0;
  private source_offset = 0;
  private destroyed = false;
  private paused = false;
  private paused_position = 0;
  private _rate: number;

  constructor(options: WebAudioPlaybackOptions) {
    this.validateRate(options.rate);
    this.audio_context = options.audio_context;
    this.audio_buffer = options.audio_buffer;
    this._rate = options.rate;
    this.performance_now = options.performance_now ?? (() => performance.now());
    this.gain = options.audio_context.createGain();
    this.setVolume(options.volume);
    this.gain.connect(options.audio_context.destination);
  }

  get rate(): number {
    return this._rate;
  }

  start(lead_in_seconds: number): void {
    this.requireUsable();
    if (this.source) throw new Error("Audio playback has already started");
    if (!Number.isFinite(lead_in_seconds) || lead_in_seconds < 0) throw new RangeError("Lead-in must not be negative");
    this.createSource(this.audio_context.currentTime + lead_in_seconds, 0);
    void this.audio_context.resume();
  }

  samplePosition(): AudioPlaybackPosition | null {
    this.requireUsable();
    if (this.paused) return { position: this.paused_position, performance_time: this.performance_now() };
    if (!this.source) return null;
    const sample = this.sampleTimestamp();
    return {
      position: this.source_offset + (sample.context_time - this.source_start_context_time) * this._rate,
      performance_time: sample.performance_time,
    };
  }

  pause(): void {
    this.requireUsable();
    if (this.paused) return;
    this.paused_position = this.samplePosition()?.position ?? this.paused_position;
    this.paused = true;
    void this.audio_context.suspend();
  }

  resume(): void {
    this.requireUsable();
    if (!this.paused) return;
    this.paused = false;
    void this.audio_context.resume();
  }

  seek(position: number): void {
    this.requireUsable();
    if (!Number.isFinite(position)) throw new RangeError("Seek position must be finite");
    const context_now = this.audio_context.currentTime;
    if (position < 0) this.replaceSource(context_now - position / this._rate, 0);
    else this.replaceSource(context_now, position);
    this.paused_position = position;
  }

  restart(lead_in_seconds: number): void {
    if (!Number.isFinite(lead_in_seconds) || lead_in_seconds < 0) throw new RangeError("Lead-in must not be negative");
    this.seek(-lead_in_seconds * this._rate);
  }

  setRate(rate: number): void {
    this.requireUsable();
    this.validateRate(rate);
    if (rate === this._rate) return;
    const position = this.samplePosition()?.position ?? this.paused_position;
    this._rate = rate;
    const context_now = this.audio_context.currentTime;
    if (position < 0) this.replaceSource(context_now - position / rate, 0);
    else this.replaceSource(context_now, position);
  }

  setVolume(volume: number): void {
    this.requireUsable();
    if (!Number.isFinite(volume) || volume < 0) throw new RangeError("Volume must not be negative");
    this.gain.gain.value = volume;
  }

  end(): void {
    this.requireUsable();
    this.stopSource();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.stopSource();
    this.gain.disconnect();
    this.destroyed = true;
  }

  private sampleTimestamp(): WebAudioTimestamp {
    try {
      const output = this.audio_context.getOutputTimestamp?.();
      const context_time = output?.contextTime;
      const performance_time = output?.performanceTime;
      if (typeof context_time === "number" && Number.isFinite(context_time) && context_time >= 0 &&
        typeof performance_time === "number" && Number.isFinite(performance_time) && performance_time > 0) {
        return { context_time, performance_time };
      }
    } catch {
      // Some browsers expose getOutputTimestamp but throw while the context is starting.
    }
    const before = this.performance_now();
    const context_time = this.audio_context.currentTime;
    const after = this.performance_now();
    return { context_time, performance_time: (before + after) / 2 };
  }

  private replaceSource(context_start_time: number, offset: number): void {
    this.stopSource();
    this.createSource(context_start_time, offset);
  }

  private createSource(context_start_time: number, offset: number): void {
    const source = this.audio_context.createBufferSource();
    source.buffer = this.audio_buffer;
    source.playbackRate.value = this._rate;
    source.connect(this.gain);
    source.onended = () => {
      if (this.source === source) this.source = null;
    };
    source.start(context_start_time, Math.max(0, offset));
    this.source = source;
    this.source_start_context_time = context_start_time;
    this.source_offset = Math.max(0, offset);
  }

  private stopSource(): void {
    if (!this.source) return;
    this.source.onended = null;
    this.source.stop();
    this.source.disconnect();
    this.source = null;
  }

  private validateRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) throw new RangeError("Music rate must be positive");
  }

  private requireUsable(): void {
    if (this.destroyed) throw new Error("Audio playback is destroyed");
  }
}
