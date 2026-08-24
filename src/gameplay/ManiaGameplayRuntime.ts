import type { ManiaGameplayData } from "../library/GameplayLoader";
import { ManiaRulesEngine, type ManiaHitRegistration, type ManiaVisualNote } from "./ManiaRulesEngine";
import type { ScoreResult } from "./scoring/ScoreEngine";
import { WebGlGameplayRenderer } from "./renderer/WebGlGameplayRenderer";
import { SpringValue } from "./SpringValue";
import type { ReplayBase } from "../replay/ReplayBase";
import { applyMusicOffset, getAudioStartDelay, getGameplayEndTime } from "./GameplayTiming";

interface ManiaRenderer {
  getTimeRange(column_count: number, scroll_speed: number): { past: number; future: number };
  draw(column_count: number, notes: readonly ManiaVisualNote[], scroll_speed: number,
    pressed_columns: ArrayLike<number>, hud: { combo: number; accuracy: number; judgment: string | null; judgmentAge: number }): void;
  destroy(): void;
}

export interface ManiaGameplayRuntimeDependencies {
  event_target: Pick<Window, "addEventListener" | "removeEventListener">;
  request_animation_frame: (callback: FrameRequestCallback) => number;
  cancel_animation_frame: (handle: number) => void;
  performance_now: () => number;
  create_renderer: (canvas: HTMLCanvasElement, data: ManiaGameplayData) => ManiaRenderer;
}

function createDefaultDependencies(): ManiaGameplayRuntimeDependencies {
  return {
    event_target: window,
    request_animation_frame: (callback) => window.requestAnimationFrame(callback),
    cancel_animation_frame: (handle) => window.cancelAnimationFrame(handle),
    performance_now: () => performance.now(),
    create_renderer: (canvas, data) => new WebGlGameplayRenderer(canvas, data.note_skin),
  };
}

export class ManiaGameplayRuntime {
  private readonly data: ManiaGameplayData;
  private readonly master_volume: number;
  private readonly music_offset: number;
  private readonly scroll_speed: number;
  private readonly music_rate: number;
  private readonly finish: (score: ScoreResult) => void;
  private readonly rules_engine: ManiaRulesEngine;
  private readonly renderer: ManiaRenderer;
  private readonly dependencies: ManiaGameplayRuntimeDependencies;
  private readonly key_columns: ReadonlyMap<string, number>;
  private readonly key_catches = new Map<string, number>();
  private readonly pointer_catches = new Map<number, number>();
  private readonly pressed_keys = new Set<string>();
  private readonly pointer_columns = new Map<number, number>();
  private readonly pressed_columns: Uint16Array;
  private animation_frame: number | null = null;
  private audio_source: AudioBufferSourceNode | null = null;
  private audio_gain: GainNode | null = null;
  private audio_start_time = 0;
  private finished = false;
  private destroyed = false;
  private readonly displayed_accuracy = new SpringValue(0);
  private previous_frame_time: number | null = null;
  private previous_judges_total = 0;
  private judgment_time = -Infinity;

  constructor(canvas: HTMLCanvasElement, data: ManiaGameplayData, master_volume: number, music_offset: number,
    scroll_speed: number, replay_base: ReplayBase, input_bindings: readonly (string | null)[], hit_registration: ManiaHitRegistration,
    finish: (score: ScoreResult) => void, dependencies: ManiaGameplayRuntimeDependencies = createDefaultDependencies()) {
    this.data = data;
    this.master_volume = master_volume;
    this.music_offset = music_offset;
    this.scroll_speed = scroll_speed;
    this.music_rate = replay_base.rate;
    this.finish = finish;
    this.dependencies = dependencies;
    this.rules_engine = new ManiaRulesEngine(data.chart, hit_registration, this.music_rate, replay_base.const, replay_base.tap_only);
    this.renderer = dependencies.create_renderer(canvas, data);
    this.key_columns = new Map(input_bindings.flatMap((code, column) => code === null ? [] : [[code, column] as const]));
    this.pressed_columns = new Uint16Array(data.chart.column_count);
  }

  start(): void {
    this.dependencies.event_target.addEventListener("keydown", this.handleKeyDown as EventListener);
    this.dependencies.event_target.addEventListener("keyup", this.handleKeyUp as EventListener);
    const gain = this.data.audio_context.createGain();
    const source = this.data.audio_context.createBufferSource();
    gain.gain.value = this.master_volume;
    source.buffer = this.data.audio_buffer;
    source.playbackRate.value = this.music_rate;
    source.connect(gain).connect(this.data.audio_context.destination);
    this.audio_start_time = this.data.audio_context.currentTime + getAudioStartDelay(this.data, this.music_rate);
    source.start(this.audio_start_time);
    this.audio_source = source;
    this.audio_gain = gain;
    void this.data.audio_context.resume();
    this.animation_frame = this.dependencies.request_animation_frame(this.render);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.dependencies.event_target.removeEventListener("keydown", this.handleKeyDown as EventListener);
    this.dependencies.event_target.removeEventListener("keyup", this.handleKeyUp as EventListener);
    if (this.animation_frame !== null) this.dependencies.cancel_animation_frame(this.animation_frame);
    if (this.audio_source) {
      this.audio_source.stop();
      this.audio_source.disconnect();
    }
    this.audio_gain?.disconnect();
    this.renderer.destroy();
  }

  pressPointer(pointer_id: number, column: number, performance_time: number): void {
    if (this.pointer_columns.has(pointer_id)) return;
    this.pointer_columns.set(pointer_id, column);
    this.pressed_columns[column]! += 1;
    const note_index = this.rules_engine.press(column, this.getSongTime(performance_time));
    if (note_index !== undefined) this.pointer_catches.set(pointer_id, note_index);
  }

  releasePointer(pointer_id: number, performance_time: number): void {
    const column = this.pointer_columns.get(pointer_id);
    if (column === undefined) return;
    this.pointer_columns.delete(pointer_id);
    this.pressed_columns[column]! -= 1;
    const note_index = this.pointer_catches.get(pointer_id);
    this.pointer_catches.delete(pointer_id);
    if (note_index !== undefined) this.rules_engine.release(note_index, this.getSongTime(performance_time));
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    if (event.code === "Escape") {
      this.abortGameplay(this.getSongTime(event.timeStamp));
      return;
    }
    const column = this.key_columns.get(event.code);
    if (column === undefined) return;
    event.preventDefault();
    this.pressed_keys.add(event.code);
    this.pressed_columns[column]! += 1;
    const note_index = this.rules_engine.press(column, this.getSongTime(event.timeStamp));
    if (note_index !== undefined) this.key_catches.set(event.code, note_index);
  };

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    const column = this.key_columns.get(event.code);
    if (column === undefined || !this.pressed_keys.delete(event.code)) return;
    event.preventDefault();
    this.pressed_columns[column]! -= 1;
    const note_index = this.key_catches.get(event.code);
    this.key_catches.delete(event.code);
    if (note_index !== undefined) this.rules_engine.release(note_index, this.getSongTime(event.timeStamp));
  };

  private getSongTime(performance_time: number): number {
    const output_timestamp = this.data.audio_context.getOutputTimestamp();
    const context_time = output_timestamp.contextTime;
    const output_performance_time = output_timestamp.performanceTime;
    const audio_time = context_time !== undefined && output_performance_time !== undefined && output_performance_time > 0
      ? context_time + (performance_time - output_performance_time) / 1000
      : this.data.audio_context.currentTime + (performance_time - this.dependencies.performance_now()) / 1000;
    return applyMusicOffset((audio_time - this.audio_start_time) * this.music_rate, this.music_rate, this.music_offset);
  }

  private abortGameplay(song_time: number): void {
    if (this.finished) return;
    for (const note_index of this.key_catches.values()) {
      this.rules_engine.release(note_index, song_time);
    }
    for (const note_index of this.pointer_catches.values()) {
      this.rules_engine.release(note_index, song_time);
    }
    this.key_catches.clear();
    this.pointer_catches.clear();
    this.pressed_keys.clear();
    this.pointer_columns.clear();
    this.pressed_columns.fill(0);
    this.rules_engine.update(getGameplayEndTime(this.data, this.music_rate), 0, 0);
    this.finishGameplay();
  }

  private readonly finishGameplay = () => {
    if (this.finished) return;
    this.finished = true;
    this.finish(this.rules_engine.score);
  };

  private readonly render = (timestamp: number) => {
    const delta_time = this.previous_frame_time === null ? 0 : (timestamp - this.previous_frame_time) / 1000;
    this.previous_frame_time = timestamp;
    const visual_scroll_speed = this.scroll_speed / this.music_rate;
    const range = this.renderer.getTimeRange(this.data.chart.column_count, visual_scroll_speed);
    const song_time = this.getSongTime(timestamp);
    this.rules_engine.update(song_time, range.past, range.future);
    const score = this.rules_engine.score;
    const target_accuracy = (score.accuracy ?? 0) * 100;
    const displayed_accuracy = this.displayed_accuracy.update(target_accuracy, delta_time);
    const judges_total = Object.values(score.judges ?? {}).reduce((total, count) => total + count, 0);
    if (judges_total !== this.previous_judges_total) {
      this.judgment_time = timestamp / 1000;
      this.previous_judges_total = judges_total;
    }
    this.renderer.draw(this.data.chart.column_count, this.rules_engine.visible_notes, visual_scroll_speed, this.pressed_columns, {
      combo: score.combo ?? 0,
      accuracy: displayed_accuracy,
      judgment: score.last_judge ?? null,
      judgmentAge: timestamp / 1000 - this.judgment_time,
    });
    if (song_time >= getGameplayEndTime(this.data, this.music_rate)) {
      this.finishGameplay();
      return;
    }
    this.animation_frame = this.dependencies.request_animation_frame(this.render);
  };
}
