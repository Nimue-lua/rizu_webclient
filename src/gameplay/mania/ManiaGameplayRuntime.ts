import type { ManiaGameplayData } from "../../library/GameplayLoader";
import { ManiaRulesEngine, type ManiaHitRegistration, type ManiaVisualNote } from "./ManiaRulesEngine";
import type { ScoreResult } from "../scoring/ScoreResult";
import type { GameplaySession, ManiaPointerInput } from "../GameplaySession";
import { ManiaRenderer as WebGlManiaRenderer } from "./rendering/ManiaRenderer";
import { HudStateDeriver, type GameplayPresentationState } from "../HudState";
import type { ManiaReplayBase } from "../../replay/mania/ManiaReplayBase";
import { getAudioStartDelay, getGameplayEndTime } from "../GameplayTiming";
import { AudioGameplayClock } from "../AudioGameplayClock";
import { WebAudioPlayback } from "../audio/WebAudioPlayback";

interface ManiaRenderer {
  getTimeRange(column_count: number, scroll_speed: number): { past: number; future: number };
  draw(column_count: number, notes: readonly ManiaVisualNote[], scroll_speed: number,
    pressed_columns: ArrayLike<number>, state: GameplayPresentationState): void;
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
    create_renderer: (canvas, data) => new WebGlManiaRenderer(canvas, data.note_skin),
  };
}

export class ManiaGameplayRuntime implements GameplaySession, ManiaPointerInput {
  private readonly data: ManiaGameplayData;
  private readonly scroll_speed: number;
  private readonly music_rate: number;
  private readonly finish: (score: ScoreResult) => void;
  private readonly rules_engine: ManiaRulesEngine;
  private readonly renderer: ManiaRenderer;
  private readonly playback: WebAudioPlayback;
  private readonly clock: AudioGameplayClock;
  private readonly dependencies: ManiaGameplayRuntimeDependencies;
  private readonly key_columns: ReadonlyMap<string, number>;
  private readonly key_catches = new Map<string, number>();
  private readonly pointer_catches = new Map<number, number>();
  private readonly pressed_keys = new Set<string>();
  private readonly pointer_columns = new Map<number, number>();
  private readonly pressed_columns: Uint16Array;
  private animation_frame: number | null = null;
  private finished = false;
  private destroyed = false;
  private readonly hud_state = new HudStateDeriver();
  private readonly gameplay_end_time: number;

  constructor(canvas: HTMLCanvasElement, data: ManiaGameplayData, master_volume: number, music_offset: number,
    scroll_speed: number, replay_base: ManiaReplayBase, input_bindings: readonly (string | null)[], hit_registration: ManiaHitRegistration,
    finish: (score: ScoreResult) => void, dependencies: ManiaGameplayRuntimeDependencies = createDefaultDependencies()) {
    this.data = data;
    this.scroll_speed = scroll_speed;
    this.music_rate = replay_base.rate;
    this.gameplay_end_time = getGameplayEndTime(data, this.music_rate);
    this.finish = finish;
    this.dependencies = dependencies;
    const timing_identity = replay_base.timings.name === "sphere" && replay_base.subtimings === null
      ? undefined
      : { timings: replay_base.timings, subtimings: replay_base.subtimings };
    this.rules_engine = new ManiaRulesEngine(data.chart, hit_registration, this.music_rate, replay_base.const,
      replay_base.tap_only, timing_identity);
    this.renderer = dependencies.create_renderer(canvas, data);
    this.playback = new WebAudioPlayback({
      audio_context: data.audio_context,
      audio_buffer: data.audio_buffer,
      volume: master_volume,
      rate: this.music_rate,
      performance_now: dependencies.performance_now,
    });
    this.clock = new AudioGameplayClock({
      rate: this.music_rate,
      music_offset_ms: music_offset,
      performance_now: dependencies.performance_now,
      sample_audio_position: () => this.playback.samplePosition(),
    });
    this.key_columns = new Map(input_bindings.flatMap((code, column) => code === null ? [] : [[code, column] as const]));
    this.pressed_columns = new Uint16Array(data.chart.column_count);
  }

  start(): void {
    this.dependencies.event_target.addEventListener("keydown", this.handleKeyDown as EventListener);
    this.dependencies.event_target.addEventListener("keyup", this.handleKeyUp as EventListener);
    const lead_in = getAudioStartDelay(this.data, this.music_rate);
    this.playback.start(lead_in);
    this.clock.start(lead_in);
    this.animation_frame = this.dependencies.request_animation_frame(this.render);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.dependencies.event_target.removeEventListener("keydown", this.handleKeyDown as EventListener);
    this.dependencies.event_target.removeEventListener("keyup", this.handleKeyUp as EventListener);
    if (this.animation_frame !== null) this.dependencies.cancel_animation_frame(this.animation_frame);
    this.playback.destroy();
    this.renderer.destroy();
  }

  pressPointer(pointer_id: number, column: number, performance_time: number): void {
    if (this.pointer_columns.has(pointer_id)) return;
    this.pointer_columns.set(pointer_id, column);
    this.pressed_columns[column]! += 1;
    const note_index = this.rules_engine.press(column, this.clock.timeAt(performance_time).corrected);
    if (note_index !== undefined) this.pointer_catches.set(pointer_id, note_index);
  }

  releasePointer(pointer_id: number, performance_time: number): void {
    const column = this.pointer_columns.get(pointer_id);
    if (column === undefined) return;
    this.pointer_columns.delete(pointer_id);
    this.pressed_columns[column]! -= 1;
    const note_index = this.pointer_catches.get(pointer_id);
    this.pointer_catches.delete(pointer_id);
    if (note_index !== undefined) this.rules_engine.release(note_index, this.clock.timeAt(performance_time).corrected);
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.code === "Escape") {
      this.abortGameplay(this.clock.timeAt(event.timeStamp).corrected);
      return;
    }
    const column = this.key_columns.get(event.code);
    if (column === undefined) return;
    event.preventDefault();
    if (event.repeat) return;
    this.pressed_keys.add(event.code);
    this.pressed_columns[column]! += 1;
    const note_index = this.rules_engine.press(column, this.clock.timeAt(event.timeStamp).corrected);
    if (note_index !== undefined) this.key_catches.set(event.code, note_index);
  };

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    const column = this.key_columns.get(event.code);
    if (column === undefined || !this.pressed_keys.delete(event.code)) return;
    event.preventDefault();
    this.pressed_columns[column]! -= 1;
    const note_index = this.key_catches.get(event.code);
    this.key_catches.delete(event.code);
    if (note_index !== undefined) this.rules_engine.release(note_index, this.clock.timeAt(event.timeStamp).corrected);
  };

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
    this.rules_engine.update(this.gameplay_end_time, 0, 0);
    this.finishGameplay();
  }

  private readonly finishGameplay = () => {
    if (this.finished) return;
    this.finished = true;
    this.finish(this.rules_engine.score);
  };

  private readonly render = (timestamp: number) => {
    const visual_scroll_speed = this.scroll_speed / this.music_rate;
    const range = this.renderer.getTimeRange(this.data.chart.column_count, visual_scroll_speed);
    const song_time = this.clock.timeAt(timestamp).monotonic;
    this.rules_engine.update(song_time, range.past, range.future);
    const score = this.rules_engine.score;
    this.renderer.draw(this.data.chart.column_count, this.rules_engine.visible_notes, visual_scroll_speed,
      this.pressed_columns, this.hud_state.update(score, timestamp / 1000));
    if (song_time >= this.gameplay_end_time) {
      this.finishGameplay();
      return;
    }
    this.animation_frame = this.dependencies.request_animation_frame(this.render);
  };
}
