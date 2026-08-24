import type { OsuGameplayData } from "../library/GameplayLoader";
import type { ReplayBase } from "../replay/ReplayBase";
import type { ScoreResult } from "./scoring/ScoreResult";
import type { GameplaySession } from "./GameplaySession";
import { AudioGameplayClock } from "./AudioGameplayClock";
import { WebAudioPlayback } from "./audio/WebAudioPlayback";
import { getAudioStartDelay, getGameplayEndTime } from "./GameplayTiming";
import { OsuRenderer } from "./renderer/OsuRenderer";

export class OsuGameplayRuntime implements GameplaySession {
  private readonly renderer: OsuRenderer;
  private readonly playback: WebAudioPlayback;
  private readonly clock: AudioGameplayClock;
  private readonly music_rate: number;
  private animation_frame: number | null = null;
  private finished = false;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, private readonly data: OsuGameplayData,
    master_volume: number, music_offset: number, replay_base: ReplayBase,
    private readonly finish: (score: ScoreResult) => void) {
    this.renderer = new OsuRenderer(canvas, data.note_skin);
    this.music_rate = replay_base.rate;
    this.playback = new WebAudioPlayback({
      audio_context: data.audio_context,
      audio_buffer: data.audio_buffer,
      volume: master_volume,
      rate: this.music_rate,
    });
    this.clock = new AudioGameplayClock({
      rate: this.music_rate,
      music_offset_ms: music_offset,
      sample_audio_position: () => this.playback.samplePosition(),
    });
  }

  start(): void {
    window.addEventListener("keydown", this.handleKeyDown);
    const lead_in = getAudioStartDelay(this.data, this.music_rate);
    this.playback.start(lead_in);
    this.clock.start(lead_in);
    this.animation_frame = requestAnimationFrame(this.render);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener("keydown", this.handleKeyDown);
    if (this.animation_frame !== null) cancelAnimationFrame(this.animation_frame);
    this.playback.destroy();
    this.renderer.destroy();
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.code === "Escape") this.finishGameplay();
  };

  private finishGameplay(): void {
    if (this.finished) return;
    this.finished = true;
    this.finish({});
  }

  private readonly render = (timestamp: number) => {
    const song_time = this.clock.timeAt(timestamp).monotonic;
    this.renderer.draw(this.data.chart, song_time);
    if (song_time >= getGameplayEndTime(this.data, this.music_rate)) {
      this.finishGameplay();
      return;
    }
    this.animation_frame = requestAnimationFrame(this.render);
  };
}
