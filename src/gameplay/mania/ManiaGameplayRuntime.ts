import type { ManiaGameplayData } from "../../library/GameplayLoader";
import { ManiaRulesEngine, type ManiaHitRegistration, type ManiaVisualNote } from "./ManiaRulesEngine";
import type { GameplayBackgroundState, GameplaySession, ManiaPointerInput } from "../GameplaySession";
import { ManiaRenderer as WebGlManiaRenderer } from "./rendering/ManiaRenderer";
import { HudStateDeriver, type GameplayPresentationState } from "../HudState";
import type { ManiaReplayBase } from "../../replay/mania/ManiaReplayBase";
import { getAudioStartDelay, getGameplayEndTime, getGameplayProgress, getGameplayProgressRange,
  getIntroSkipTime } from "../GameplayTiming";
import { AudioGameplayClock } from "../AudioGameplayClock";
import { WebAudioPlayback } from "../audio/WebAudioPlayback";
import { replayTick, replayValue, type CompletedGameplay, type ManiaRecordedInputEvent,
  type ManiaRecordedReplay } from "../../replay/RecordedReplay";
import type { GameplayPerformanceSample } from "../GameplayPerformance";
import type { GameplayRenderStats } from "../renderer/GameplayRenderStats";

interface ManiaRenderer {
  getTimeRange(column_count: number, scroll_speed: number): { past: number; future: number };
  draw(column_count: number, notes: readonly ManiaVisualNote[], scroll_speed: number,
    pressed_columns: ArrayLike<number>, state: GameplayPresentationState,
    progress?: number | null): GameplayRenderStats;
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
  readonly input_events: ManiaRecordedInputEvent[] = [];
  private readonly finish: (completed: CompletedGameplay, reached_chart_end: boolean) => void;
  private readonly replay_base: ManiaReplayBase;
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
  private readonly last_note_time: number;
  private readonly first_note_time: number;
  private replay_event_index = 0;
  private readonly progress_range;
  private readonly intro_skip_time: number | null;
  private readonly music_offset_time: number;
  private background_state: GameplayBackgroundState | null = null;

  constructor(canvas: HTMLCanvasElement, data: ManiaGameplayData, master_volume: number, music_offset: number,
    scroll_speed: number, replay_base: ManiaReplayBase, input_bindings: readonly (string | null)[], hit_registration: ManiaHitRegistration,
    finish: (completed: CompletedGameplay, reached_chart_end: boolean) => void,
    dependencies: ManiaGameplayRuntimeDependencies = createDefaultDependencies(),
    private readonly playback_replay?: ManiaRecordedReplay,
    private readonly initial_lead_in = 0,
    private readonly background_state_change?: (state: GameplayBackgroundState) => void,
    private readonly performance_sample?: (sample: GameplayPerformanceSample) => void) {
    this.data = data;
    this.scroll_speed = scroll_speed;
    this.music_rate = replay_base.rate;
    this.music_offset_time = music_offset / 1000 * this.music_rate;
    this.replay_base = replay_base;
    this.gameplay_end_time = getGameplayEndTime(data, this.music_rate);
    this.progress_range = getGameplayProgressRange(data, this.music_rate);
    this.intro_skip_time = getIntroSkipTime(data, this.music_rate);
    this.last_note_time = data.chart.notes.reduce((last, note) => Math.max(last, note.absolute_time), -Infinity);
    this.first_note_time = data.chart.notes.reduce((first, note) => Math.min(first, note.absolute_time), Infinity);
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
    if (!this.playback_replay) {
      this.dependencies.event_target.addEventListener("keyup", this.handleKeyUp as EventListener);
    }
    const lead_in = getAudioStartDelay(this.data, this.music_rate, this.initial_lead_in);
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
    if (this.playback_replay) return;
    if (this.pointer_columns.has(pointer_id)) return;
    this.pointer_columns.set(pointer_id, column);
    this.pressed_columns[column]! += 1;
    const time = this.clock.timeAt(performance_time).corrected;
    const previous_logic_event_count = this.rules_engine.logic_events.length;
    const note_index = this.rules_engine.press(column, time);
    this.recordInput(column, true, time, note_index, previous_logic_event_count);
    if (note_index !== undefined) this.pointer_catches.set(pointer_id, note_index);
  }

  releasePointer(pointer_id: number, performance_time: number): void {
    if (this.playback_replay) return;
    const column = this.pointer_columns.get(pointer_id);
    if (column === undefined) return;
    this.pointer_columns.delete(pointer_id);
    this.pressed_columns[column]! -= 1;
    const note_index = this.pointer_catches.get(pointer_id);
    this.pointer_catches.delete(pointer_id);
    const time = this.clock.timeAt(performance_time).corrected;
    const previous_logic_event_count = this.rules_engine.logic_events.length;
    if (note_index !== undefined) this.rules_engine.release(note_index, time);
    this.recordInput(column, false, time, note_index, previous_logic_event_count);
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.code === "Escape") {
      this.abortGameplay(this.clock.timeAt(event.timeStamp).corrected);
      return;
    }
    if (event.code === "Space" && this.skipIntro(event.timeStamp)) {
      event.preventDefault();
      return;
    }
    if (this.playback_replay) return;
    const column = this.key_columns.get(event.code);
    if (column === undefined) return;
    event.preventDefault();
    if (event.repeat) return;
    this.pressed_keys.add(event.code);
    this.pressed_columns[column]! += 1;
    const time = this.clock.timeAt(event.timeStamp).corrected;
    const previous_logic_event_count = this.rules_engine.logic_events.length;
    const note_index = this.rules_engine.press(column, time);
    this.recordInput(column, true, time, note_index, previous_logic_event_count);
    if (note_index !== undefined) this.key_catches.set(event.code, note_index);
  };

  private skipIntro(performance_time: number): boolean {
    if (this.intro_skip_time === null || this.clock.timeAt(performance_time).corrected >= this.intro_skip_time) return false;
    this.playback.seek(this.intro_skip_time - this.music_offset_time);
    this.clock.seek(this.intro_skip_time);
    return true;
  }

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    const column = this.key_columns.get(event.code);
    if (column === undefined || !this.pressed_keys.delete(event.code)) return;
    event.preventDefault();
    this.pressed_columns[column]! -= 1;
    const note_index = this.key_catches.get(event.code);
    this.key_catches.delete(event.code);
    const time = this.clock.timeAt(event.timeStamp).corrected;
    const previous_logic_event_count = this.rules_engine.logic_events.length;
    if (note_index !== undefined) this.rules_engine.release(note_index, time);
    this.recordInput(column, false, time, note_index, previous_logic_event_count);
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
    this.finishGameplay(Number.isFinite(this.last_note_time) && song_time >= this.last_note_time);
  }

  private readonly finishGameplay = (reached_chart_end = true) => {
    if (this.finished) return;
    this.finished = true;
    this.finish({
      score: this.rules_engine.score,
      replay_base: this.replay_base.exportReplayBase(),
      replay: {
        version: 1,
        mode: "mania",
        time_unit: "1/8192 second",
        input_events: this.input_events,
        logic_events: this.rules_engine.logic_events.map((event) => ({
          ...event, time: replayTick(event.time), delta_time: replayTick(event.delta_time),
        })),
      },
    }, reached_chart_end);
  };

  private recordInput(column: number, pressed: boolean, time: number, note_index: number | undefined,
    previous_logic_event_count: number): void {
    const logic_event = this.rules_engine.logic_events[previous_logic_event_count];
    const delta_time = logic_event !== undefined && logic_event.index === note_index
      ? replayTick(logic_event.delta_time)
      : null;
    this.input_events.push({
      time: replayTick(time), column, pressed, note_index: note_index ?? null, delta_time,
    });
  }

  private readonly render = (timestamp: number) => {
    const visual_scroll_speed = this.scroll_speed / this.music_rate;
    const range = this.renderer.getTimeRange(this.data.chart.column_count, visual_scroll_speed);
    const song_time = this.clock.timeAt(timestamp).monotonic;
    this.updateBackgroundState(song_time);
    this.applyReplayEvents(song_time);
    const update_start = this.dependencies.performance_now();
    this.rules_engine.update(song_time, range.past, range.future);
    const update_ms = this.dependencies.performance_now() - update_start;
    const score = this.rules_engine.score;
    const draw_start = this.dependencies.performance_now();
    const render_stats = this.renderer.draw(this.data.chart.column_count, this.rules_engine.visible_notes, visual_scroll_speed,
      this.pressed_columns, this.hud_state.update(score, timestamp / 1000),
      getGameplayProgress(song_time, this.progress_range));
    const draw_ms = this.dependencies.performance_now() - draw_start;
    this.performance_sample?.({ timestamp, update_ms, draw_ms, ...render_stats });
    if (song_time >= this.gameplay_end_time) {
      this.finishGameplay();
      return;
    }
    this.animation_frame = this.dependencies.request_animation_frame(this.render);
  };

  private updateBackgroundState(song_time: number): void {
    const visible = song_time < this.first_note_time - 1.2 || song_time > this.last_note_time ||
      (this.data.chart.break_periods ?? []).some((period) => period.start_time <= song_time && song_time <= period.end_time);
    const state = visible ? "visible" : "hidden";
    if (state === this.background_state) return;
    this.background_state = state;
    this.background_state_change?.(state);
  }

  private applyReplayEvents(song_time: number): void {
    const events = this.playback_replay?.input_events;
    if (!events) return;
    while (this.replay_event_index < events.length) {
      const event = events[this.replay_event_index]!;
      const event_time = replayValue(event.time);
      if (event_time > song_time) break;
      if (event.pressed) {
        this.pressed_columns[event.column]! += 1;
        this.rules_engine.press(event.column, event_time);
      } else {
        this.pressed_columns[event.column] = Math.max(0, this.pressed_columns[event.column]! - 1);
        if (event.note_index !== null) this.rules_engine.release(event.note_index, event_time);
      }
      this.replay_event_index += 1;
    }
  }

}
