import type { OsuGameplayData } from "../library/GameplayLoader";
import type { ReplayBase } from "../replay/ReplayBase";
import type { ScoreResult } from "./scoring/ScoreEngine";
import { applyMusicOffset, getAudioStartDelay, getGameplayEndTime } from "./GameplayTiming";
import { WebGlGameplayRenderer } from "./renderer/WebGlGameplayRenderer";

export class OsuGameplayRuntime {
  private readonly renderer: WebGlGameplayRenderer;
  private readonly music_rate: number;
  private animation_frame: number | null = null;
  private audio_source: AudioBufferSourceNode | null = null;
  private audio_start_time = 0;
  private finished = false;

  constructor(canvas: HTMLCanvasElement, private readonly data: OsuGameplayData,
    private readonly master_volume: number, private readonly music_offset: number, replay_base: ReplayBase,
    private readonly finish: (score: ScoreResult) => void) {
    this.renderer = new WebGlGameplayRenderer(canvas, data.note_skin);
    this.music_rate = replay_base.rate;
  }

  start(): void {
    window.addEventListener("keydown", this.handleKeyDown);
    const gain = this.data.audio_context.createGain();
    const source = this.data.audio_context.createBufferSource();
    gain.gain.value = this.master_volume;
    source.buffer = this.data.audio_buffer;
    source.playbackRate.value = this.music_rate;
    source.connect(gain).connect(this.data.audio_context.destination);
    this.audio_start_time = this.data.audio_context.currentTime + getAudioStartDelay(this.data, this.music_rate);
    source.start(this.audio_start_time);
    this.audio_source = source;
    void this.data.audio_context.resume();
    this.animation_frame = requestAnimationFrame(this.render);
  }

  destroy(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    if (this.animation_frame !== null) cancelAnimationFrame(this.animation_frame);
    if (this.audio_source) {
      this.audio_source.stop();
      this.audio_source.disconnect();
    }
    this.renderer.destroy();
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.code === "Escape") this.finishGameplay();
  };

  private getSongTime(timestamp: number): number {
    const output = this.data.audio_context.getOutputTimestamp();
    const audio_time = output.contextTime !== undefined && output.performanceTime !== undefined && output.performanceTime > 0
      ? output.contextTime + (timestamp - output.performanceTime) / 1000
      : this.data.audio_context.currentTime + (timestamp - performance.now()) / 1000;
    return applyMusicOffset((audio_time - this.audio_start_time) * this.music_rate, this.music_rate, this.music_offset);
  }

  private finishGameplay(): void {
    if (this.finished) return;
    this.finished = true;
    this.finish({});
  }

  private readonly render = (timestamp: number) => {
    const song_time = this.getSongTime(timestamp);
    this.renderer.drawOsu(this.data.chart, song_time);
    if (song_time >= getGameplayEndTime(this.data, this.music_rate)) {
      this.finishGameplay();
      return;
    }
    this.animation_frame = requestAnimationFrame(this.render);
  };
}
