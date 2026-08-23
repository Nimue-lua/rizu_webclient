import type { GameplayData } from "../library/GameplayLoader";
import { RhythmEngine, type HitRegistration } from "./RhythmEngine";
import type { ScoreResult } from "./scoring/ScoreEngine";
import { WebGlGameplayRenderer } from "./renderer/WebGlGameplayRenderer";
import { SpringValue } from "./SpringValue";
import type { ReplayBase } from "../replay/ReplayBase";

const AUDIO_SCHEDULE_MARGIN = 0.1;
const FIRST_NOTE_LEAD_IN = 1.2;
const RESULT_DELAY = 1.2;

export function getAudioStartDelay(data: GameplayData, music_rate: number): number {
  const first_note_time = data.chart.notes.reduce((first, note) => note.weight >= 0 ? Math.min(first, note.absolute_time) : first, Infinity);
  if (!Number.isFinite(first_note_time)) return AUDIO_SCHEDULE_MARGIN;
  return Math.max(AUDIO_SCHEDULE_MARGIN, FIRST_NOTE_LEAD_IN - first_note_time / music_rate);
}

export function getGameplayEndTime(data: GameplayData, music_rate: number): number {
  const last_note_time = data.chart.notes.reduce((last, note) => Math.max(last, note.absolute_time), -Infinity);
  return last_note_time + RESULT_DELAY * music_rate;
}

export class GameplayRuntime {
  private readonly accuracy_element: HTMLElement;
  private readonly judge_element: HTMLElement;
  private readonly combo_element: HTMLElement;
  private readonly data: GameplayData;
  private readonly master_volume: number;
  private readonly scroll_speed: number;
  private readonly music_rate: number;
  private readonly finish: (score: ScoreResult) => void;
  private readonly rhythm_engine: RhythmEngine;
  private readonly renderer: WebGlGameplayRenderer;
  private readonly key_columns: ReadonlyMap<string, number>;
  private readonly key_catches = new Map<string, number>();
  private animation_frame: number | null = null;
  private audio_source: AudioBufferSourceNode | null = null;
  private audio_start_time = 0;
  private finished = false;
  private readonly displayed_accuracy = new SpringValue(0);
  private readonly combo_offset = new SpringValue(0, 14);
  private previous_frame_time: number | null = null;
  private previous_combo = 0;
  private previous_judges_total = 0;

  constructor(canvas: HTMLCanvasElement, accuracy_element: HTMLElement, judge_element: HTMLElement,
    combo_element: HTMLElement, data: GameplayData, master_volume: number,
    scroll_speed: number, replay_base: ReplayBase, input_bindings: readonly (string | null)[], hit_registration: HitRegistration,
    finish: (score: ScoreResult) => void) {
    this.accuracy_element = accuracy_element;
    this.judge_element = judge_element;
    this.combo_element = combo_element;
    this.data = data;
    this.master_volume = master_volume;
    this.scroll_speed = scroll_speed;
    this.music_rate = replay_base.rate;
    this.finish = finish;
    this.rhythm_engine = new RhythmEngine(data.chart, hit_registration, this.music_rate, replay_base.const, replay_base.tap_only);
    this.renderer = new WebGlGameplayRenderer(canvas);
    this.key_columns = new Map(input_bindings.flatMap((code, column) => code === null ? [] : [[code, column] as const]));
  }

  start(): void {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
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
    window.removeEventListener("keyup", this.handleKeyUp);
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
      this.finishGameplay();
      return;
    }
    const column = this.key_columns.get(event.code);
    if (column === undefined) return;
    event.preventDefault();
    const note_index = this.rhythm_engine.press(column, this.getSongTime(event.timeStamp));
    if (note_index !== undefined) this.key_catches.set(event.code, note_index);
  };

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    const note_index = this.key_catches.get(event.code);
    if (note_index === undefined) return;
    event.preventDefault();
    this.rhythm_engine.release(note_index, this.getSongTime(event.timeStamp));
    this.key_catches.delete(event.code);
  };

  private getSongTime(performance_time: number): number {
    const output_timestamp = this.data.audio_context.getOutputTimestamp();
    const context_time = output_timestamp.contextTime;
    const output_performance_time = output_timestamp.performanceTime;
    const audio_time = context_time !== undefined && output_performance_time !== undefined && output_performance_time > 0
      ? context_time + (performance_time - output_performance_time) / 1000
      : this.data.audio_context.currentTime + (performance_time - performance.now()) / 1000;
    return (audio_time - this.audio_start_time) * this.music_rate;
  }

  private readonly finishGameplay = () => {
    if (this.finished) return;
    this.finished = true;
    this.finish(this.rhythm_engine.score);
  };

  private readonly render = (timestamp: number) => {
    const delta_time = this.previous_frame_time === null ? 0 : (timestamp - this.previous_frame_time) / 1000;
    this.previous_frame_time = timestamp;
    const visual_scroll_speed = this.scroll_speed / this.music_rate;
    const range = this.renderer.getTimeRange(this.data.chart.column_count, visual_scroll_speed);
    const song_time = this.getSongTime(timestamp);
    this.rhythm_engine.update(song_time, range.past, range.future);
    this.renderer.draw(this.data.chart.column_count, this.rhythm_engine.visible_notes, visual_scroll_speed);
    const score = this.rhythm_engine.score;
    const target_accuracy = (score.accuracy ?? 0) * 100;
    this.accuracy_element.textContent = `${this.displayed_accuracy.update(target_accuracy, delta_time).toFixed(2)}%`;
    const judges_total = Object.values(score.judges ?? {}).reduce((total, count) => total + count, 0);
    if (judges_total !== this.previous_judges_total) {
      this.judge_element.textContent = score.last_judge ?? "";
      this.judge_element.dataset.judge = score.last_judge ?? "";
      this.previous_judges_total = judges_total;
    }
    const combo = score.combo ?? 0;
    if (combo > this.previous_combo) this.combo_offset.teleport(-10);
    this.combo_element.textContent = `${combo}x`;
    this.combo_element.style.transform = `translateY(${this.combo_offset.update(0, delta_time).toFixed(2)}px)`;
    this.previous_combo = combo;
    if (song_time >= getGameplayEndTime(this.data, this.music_rate)) {
      this.finishGameplay();
      return;
    }
    this.animation_frame = requestAnimationFrame(this.render);
  };
}
