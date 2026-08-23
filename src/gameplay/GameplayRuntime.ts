import type { GameplayData } from "../library/GameplayLoader";
import { RhythmEngine } from "./RhythmEngine";
import { WebGlGameplayRenderer } from "./renderer/WebGlGameplayRenderer";

export class GameplayRuntime {
  private readonly fps_element: HTMLElement;
  private readonly data: GameplayData;
  private readonly master_volume: number;
  private readonly scroll_speed: number;
  private readonly finish: () => void;
  private readonly rhythm_engine: RhythmEngine;
  private readonly renderer: WebGlGameplayRenderer;
  private readonly key_columns: ReadonlyMap<string, number>;
  private animation_frame: number | null = null;
  private audio_source: AudioBufferSourceNode | null = null;
  private audio_start_time = 0;
  private fps_frame_count = 0;
  private fps_sample_start = 0;

  constructor(canvas: HTMLCanvasElement, fps_element: HTMLElement, data: GameplayData, master_volume: number,
    scroll_speed: number, input_bindings: readonly (string | null)[], finish: () => void) {
    this.fps_element = fps_element;
    this.data = data;
    this.master_volume = master_volume;
    this.scroll_speed = scroll_speed;
    this.finish = finish;
    this.rhythm_engine = new RhythmEngine(data.chart);
    this.renderer = new WebGlGameplayRenderer(canvas);
    this.key_columns = new Map(input_bindings.flatMap((code, column) => code === null ? [] : [[code, column] as const]));
  }

  start(): void {
    window.addEventListener("keydown", this.handleKeyDown);
    const gain = this.data.audio_context.createGain();
    const source = this.data.audio_context.createBufferSource();
    gain.gain.value = this.master_volume;
    source.buffer = this.data.audio_buffer;
    source.connect(gain).connect(this.data.audio_context.destination);
    this.audio_start_time = this.data.audio_context.currentTime + 0.1;
    this.fps_sample_start = performance.now();
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
    if (event.repeat) return;
    if (event.code === "Escape") {
      this.finish();
      return;
    }
    const column = this.key_columns.get(event.code);
    if (column === undefined) return;
    event.preventDefault();
    this.rhythm_engine.press(column, this.getSongTime(event.timeStamp));
  };

  private getSongTime(performance_time: number): number {
    const output_timestamp = this.data.audio_context.getOutputTimestamp();
    const context_time = output_timestamp.contextTime;
    const output_performance_time = output_timestamp.performanceTime;
    const audio_time = context_time !== undefined && output_performance_time !== undefined && output_performance_time > 0
      ? context_time + (performance_time - output_performance_time) / 1000
      : this.data.audio_context.currentTime + (performance_time - performance.now()) / 1000;
    return (audio_time - this.audio_start_time) * 1000;
  }

  private readonly render = (timestamp: number) => {
    const range = this.renderer.getTimeRange(this.data.chart.column_count, this.scroll_speed);
    this.rhythm_engine.update(this.getSongTime(timestamp), range.past, range.future);
    this.renderer.draw(this.data.chart.column_count, this.rhythm_engine.visible_notes, this.scroll_speed);
    this.fps_frame_count += 1;
    const sample_duration = timestamp - this.fps_sample_start;
    if (sample_duration >= 500) {
      this.fps_element.textContent = `${Math.round((this.fps_frame_count * 1000) / sample_duration)} FPS`;
      this.fps_frame_count = 0;
      this.fps_sample_start = timestamp;
    }
    this.animation_frame = requestAnimationFrame(this.render);
  };
}
