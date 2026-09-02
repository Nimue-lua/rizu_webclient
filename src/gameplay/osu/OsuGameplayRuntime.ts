import type { OsuGameplayData } from "../../library/GameplayLoader";
import type { OsuReplayBaseValues } from "../../replay/osu/OsuReplayBase";
import { AudioGameplayClock } from "../AudioGameplayClock";
import type { GameplayBackgroundState, GameplaySession, OsuPointerInput } from "../GameplaySession";
import { getAudioStartDelay, getGameplayEndTime, getGameplayProgress, getGameplayProgressRange,
  getIntroSkipTime } from "../GameplayTiming";
import { HudStateDeriver } from "../HudState";
import type { OsuAction, OsuCursorState, OsuInputEvent } from "./OsuInputEvent";
import { OsuRulesEngine } from "./OsuRulesEngine";
import { applyOsuHitObjectStacking } from "./OsuHitObjectStacking";
import { WebAudioPlayback } from "../audio/WebAudioPlayback";
import { OsuHitSoundPlayer } from "./audio/OsuHitSoundPlayer";
import { OsuRenderer, type OsuGameplayRenderer } from "./rendering/OsuRenderer";
import { calculateOsuStandardDifficultyMultiplier } from "./scoring/OsuStandardDifficulty";
import type { OsuCursorRendererMode } from "./OsuHardwareCursor";
import { resolveOsuStandardTimingValues } from "../timing/TimingValuesFactory";
import { Timings } from "../timing/Timings";
import { replayTick, replayValue, type CompletedGameplay, type OsuRecordedReplay } from "../../replay/RecordedReplay";
import { osuApproachPreempt } from "./OsuCircleGeometry";
import type { GameplayPerformanceSample } from "../GameplayPerformance";
import { createOsuSliderPaths, type OsuSliderPath } from "./OsuSliderPath";
import type { OsuSlider } from "../../chart/Chart";
import type { HitErrorMeterType } from "../renderer/GameplayHudRenderer";

export interface OsuGameplayRuntimeDependencies {
  event_target: Pick<Window, "addEventListener" | "removeEventListener">;
  request_animation_frame: (callback: FrameRequestCallback) => number;
  cancel_animation_frame: (handle: number) => void;
  performance_now: () => number;
  create_renderer: (canvas: HTMLCanvasElement, data: OsuGameplayData,
    replay_base: OsuReplayBaseValues, cursor_scale: number, cursor_renderer: OsuCursorRendererMode,
    slider_paths: ReadonlyMap<OsuSlider, OsuSliderPath>, hit_error_meter: boolean,
    hit_error_meter_type: HitErrorMeterType, hit_error_meter_scale: number) => OsuGameplayRenderer;
}

function createDefaultDependencies(): OsuGameplayRuntimeDependencies {
  return {
    event_target: window,
    request_animation_frame: (callback) => window.requestAnimationFrame(callback),
    cancel_animation_frame: (handle) => window.cancelAnimationFrame(handle),
    performance_now: () => performance.now(),
    create_renderer: (canvas, data, replay_base, cursor_scale, cursor_renderer, slider_paths,
      hit_error_meter, hit_error_meter_type, hit_error_meter_scale) =>
      new OsuRenderer(canvas, data.note_skin, undefined, replay_base.x_flip, replay_base.y_flip,
        cursor_scale, cursor_renderer === "webgl", data.chart, slider_paths,
        { enabled: hit_error_meter, type: hit_error_meter_type, scale: hit_error_meter_scale }),
  };
}

export class OsuGameplayRuntime implements GameplaySession, OsuPointerInput {
  readonly input_events: OsuInputEvent[] = [];
  private readonly renderer: OsuGameplayRenderer;
  private readonly playback: WebAudioPlayback;
  private readonly hit_sound_player: OsuHitSoundPlayer;
  private readonly clock: AudioGameplayClock;
  private readonly music_rate: number;
  private readonly replay_base: OsuReplayBaseValues;
  private readonly hud_state = new HudStateDeriver();
  private readonly rules_engine: OsuRulesEngine;
  private readonly chart: OsuGameplayData["chart"];
  private readonly dependencies: OsuGameplayRuntimeDependencies;
  private readonly key_actions = new Map<string, OsuAction>();
  private readonly pressed_keys = new Set<string>();
  private readonly pointer_actions = new Map<number, Set<OsuAction>>();
  private readonly action_sources = { primary: 0, secondary: 0 };
  private cursor_position = { x: 256, y: 192 };
  private animation_frame: number | null = null;
  private finished = false;
  private destroyed = false;
  private played_judgment_events = 0;
  private pending_aim: Extract<OsuInputEvent, { type: "aim" }> | null = null;
  private last_recorded_aim_performance_time = Number.NEGATIVE_INFINITY;
  private replay_event_index = 0;
  private replay_aim_index = 0;
  private readonly replay_aim_events: Array<{ time: number; x: number; y: number }>;
  private readonly progress_range;
  private readonly intro_skip_time: number | null;
  private readonly music_offset_time: number;
  private readonly outro_start_time: number;
  private background_state: GameplayBackgroundState | null = null;

  constructor(canvas: HTMLCanvasElement, private readonly data: OsuGameplayData,
    master_volume: number, hit_sound_volume: number, music_offset: number, cursor_scale: number,
    cursor_renderer: OsuCursorRendererMode, hit_error_meter: boolean, hit_error_meter_type: HitErrorMeterType,
    hit_error_meter_scale: number,
    replay_base: OsuReplayBaseValues,
    input_bindings: readonly (string | null)[],
    private readonly finish: (completed: CompletedGameplay, reached_chart_end: boolean) => void,
    dependencies: OsuGameplayRuntimeDependencies = createDefaultDependencies(),
    private readonly playback_replay?: OsuRecordedReplay,
    private readonly initial_lead_in = 0,
    private readonly background_state_change?: (state: GameplayBackgroundState) => void,
    private readonly performance_sample?: (sample: GameplayPerformanceSample) => void) {
    this.dependencies = dependencies;
    this.music_rate = replay_base.rate;
    this.music_offset_time = music_offset / 1000 * this.music_rate;
    this.replay_base = replay_base;
    this.progress_range = getGameplayProgressRange(data, this.music_rate);
    this.intro_skip_time = getIntroSkipTime(data, this.music_rate);
    this.replay_aim_events = (playback_replay?.input_events ?? []).flatMap((event) => event.type === "aim"
      ? [{ time: replayValue(event.time), x: replayValue(event.x), y: replayValue(event.y) }]
      : []);
    const timing_configuration = resolveOsuStandardTimingValues(Timings.fromValue(replay_base.timings));
    const chart = applyOsuHitObjectStacking(data.chart, replay_base.approach_rate ?? data.chart.approach_rate,
      replay_base.circle_size ?? data.chart.circle_size);
    this.chart = chart;
    const slider_paths = createOsuSliderPaths(chart);
    this.outro_start_time = chart.end_time + timing_configuration.values.hit_50;
    this.renderer = dependencies.create_renderer(canvas, { ...data, chart }, replay_base, cursor_scale, cursor_renderer,
      slider_paths, hit_error_meter, hit_error_meter_type, hit_error_meter_scale);
    const difficulty_multiplier = calculateOsuStandardDifficultyMultiplier(chart.hp_drain_rate,
      replay_base.overall_difficulty ?? chart.overall_difficulty ?? 5,
      replay_base.circle_size ?? chart.circle_size, chart.object_count, chart.drain_length_seconds);
    this.rules_engine = new OsuRulesEngine(chart, timing_configuration.values, difficulty_multiplier, slider_paths);
    this.playback = new WebAudioPlayback({
      audio_context: data.audio_context,
      audio_buffer: data.audio_buffer,
      volume: master_volume,
      rate: this.music_rate,
      performance_now: dependencies.performance_now,
    });
    this.hit_sound_player = new OsuHitSoundPlayer(data.audio_context, chart, data.note_skin,
      master_volume * hit_sound_volume,
      timing_configuration.values);
    this.clock = new AudioGameplayClock({
      rate: this.music_rate,
      music_offset_ms: music_offset,
      performance_now: dependencies.performance_now,
      sample_audio_position: () => this.playback.samplePosition(),
    });
    const actions = ["primary", "secondary"] as const;
    input_bindings.forEach((code, index) => {
      const action = actions[index];
      if (code !== null && action !== undefined) this.key_actions.set(code, action);
    });
  }

  get cursor_state(): OsuCursorState {
    return {
      position: this.cursor_position,
      primary: this.action_sources.primary > 0,
      secondary: this.action_sources.secondary > 0,
    };
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
    this.hit_sound_player.destroy();
    this.renderer.destroy();
  }

  aimPointer(_pointer_id: number, client_x: number, client_y: number,
    bounds: { left: number; top: number; width: number; height: number }, performance_time: number): void {
    if (this.playback_replay) return;
    const position = this.renderer.clientToPlayfield({ x: client_x, y: client_y }, bounds);
    this.cursor_position = position;
    const time = this.clock.timeAt(performance_time).corrected;
    this.pending_aim = { type: "aim", time, x: position.x, y: position.y };
    this.rules_engine.setInput(position.x, position.y,
      this.action_sources.primary > 0 || this.action_sources.secondary > 0, time);
  }

  pressPointer(pointer_id: number, action: OsuAction, performance_time: number): void {
    if (this.playback_replay) return;
    const actions = this.pointer_actions.get(pointer_id) ?? new Set<OsuAction>();
    if (actions.has(action)) return;
    actions.add(action);
    this.pointer_actions.set(pointer_id, actions);
    this.changeAction(action, true, performance_time);
  }

  releasePointer(pointer_id: number, action: OsuAction, performance_time: number): void {
    if (this.playback_replay) return;
    const actions = this.pointer_actions.get(pointer_id);
    if (!actions?.delete(action)) return;
    if (actions.size === 0) this.pointer_actions.delete(pointer_id);
    this.changeAction(action, false, performance_time);
  }

  cancelPointer(pointer_id: number, performance_time: number): void {
    if (this.playback_replay) return;
    const actions = this.pointer_actions.get(pointer_id);
    if (!actions) return;
    this.pointer_actions.delete(pointer_id);
    for (const action of actions) this.changeAction(action, false, performance_time);
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.code === "Escape") {
      const song_time = this.clock.timeAt(event.timeStamp).corrected;
      this.rules_engine.update(Number.POSITIVE_INFINITY);
      this.finishGameplay(this.chart.hit_objects.length > 0 && song_time >= this.chart.end_time);
      return;
    }
    if (event.code === "Space" && this.skipIntro(event.timeStamp)) {
      event.preventDefault();
      return;
    }
    if (this.playback_replay) return;
    const action = this.key_actions.get(event.code);
    if (action === undefined) return;
    event.preventDefault();
    if (event.repeat || this.pressed_keys.has(event.code)) return;
    this.pressed_keys.add(event.code);
    this.changeAction(action, true, event.timeStamp);
  };

  private skipIntro(performance_time: number): boolean {
    if (this.intro_skip_time === null || this.clock.timeAt(performance_time).corrected >= this.intro_skip_time) return false;
    this.playback.seek(this.intro_skip_time - this.music_offset_time);
    this.clock.seek(this.intro_skip_time);
    return true;
  }

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    const action = this.key_actions.get(event.code);
    if (action === undefined || !this.pressed_keys.delete(event.code)) return;
    event.preventDefault();
    this.changeAction(action, false, event.timeStamp);
  };

  private changeAction(action: OsuAction, pressed: boolean, performance_time: number): void {
    const previous = this.action_sources[action];
    this.action_sources[action] = Math.max(0, previous + (pressed ? 1 : -1));
    const current = this.action_sources[action];
    if ((previous === 0) === (current === 0)) return;
    const time = this.clock.timeAt(performance_time).corrected;
    const pressed_now = current > 0;
    this.flushPendingAim(performance_time, true);
    this.input_events.push({ type: "action", time, action, pressed: pressed_now });
    this.rules_engine.setInput(this.cursor_position.x, this.cursor_position.y,
      this.action_sources.primary > 0 || this.action_sources.secondary > 0, time);
    if (pressed_now) {
      this.rules_engine.click(this.cursor_position.x, this.cursor_position.y, time);
      this.playHitSounds();
    }
  }

  private finishGameplay(reached_chart_end = true): void {
    if (this.finished) return;
    this.finished = true;
    this.flushPendingAim(Number.POSITIVE_INFINITY, true);
    this.finish({
      score: this.rules_engine.score,
      replay_base: this.replay_base,
      replay: {
        version: 1,
        mode: "osu",
        time_unit: "1/8192 second",
        input_events: this.input_events.map((event) => event.type === "aim"
          ? { ...event, time: replayTick(event.time), x: replayTick(event.x), y: replayTick(event.y) }
          : { ...event, time: replayTick(event.time) }),
        judgment_events: this.rules_engine.judgment_events.map((event) => ({
          ...event,
          time: replayTick(event.time),
          ...("delta_time" in event ? { delta_time: replayTick(event.delta_time) } : {}),
        })),
      },
    }, reached_chart_end);
  }

  private readonly render = (timestamp: number) => {
    this.flushPendingAim(timestamp, false);
    const song_time = this.clock.timeAt(timestamp).monotonic;
    this.updateBackgroundState(song_time);
    this.applyReplayEvents(song_time);
    if (this.playback_replay) {
      this.updateReplayCursor(song_time);
      this.rules_engine.setInput(this.cursor_position.x, this.cursor_position.y,
        this.action_sources.primary > 0 || this.action_sources.secondary > 0, song_time);
    }
    const update_start = this.dependencies.performance_now();
    this.rules_engine.update(song_time);
    const update_ms = this.dependencies.performance_now() - update_start;
    this.playHitSounds();
    const first_active_index = this.rules_engine.first_active_circle_index;
    const slider_states = this.rules_engine.slider_states;
    const spinner_state = this.rules_engine.spinner_state;
    const draw_start = this.dependencies.performance_now();
    const render_stats = this.renderer.draw(this.chart, this.rules_engine.circle_states,
      first_active_index, this.rules_engine.circle_transients, song_time,
      this.hud_state.update(this.rules_engine.score, timestamp / 1000), this.cursor_state,
      slider_states, spinner_state,
      getGameplayProgress(song_time, this.progress_range));
    const draw_ms = this.dependencies.performance_now() - draw_start;
    this.performance_sample?.({ timestamp, update_ms, draw_ms, ...render_stats });
    if (song_time >= getGameplayEndTime(this.data, this.music_rate)) {
      this.finishGameplay();
      return;
    }
    this.animation_frame = this.dependencies.request_animation_frame(this.render);
  };

  private updateBackgroundState(song_time: number): void {
    const first_object_time = this.chart.hit_objects[0]?.absolute_time ?? Infinity;
    const visible = song_time < first_object_time - osuApproachPreempt(this.chart.approach_rate) ||
      song_time > this.outro_start_time ||
      (this.chart.break_periods ?? []).some((period) => period.start_time <= song_time && song_time <= period.end_time);
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
      if (event.type === "aim") {
        this.updateReplayCursor(event_time);
      } else {
        this.updateReplayCursor(event_time);
        this.action_sources[event.action] = event.pressed ? 1 : 0;
      }
      const pressed = this.action_sources.primary > 0 || this.action_sources.secondary > 0;
      this.rules_engine.setInput(this.cursor_position.x, this.cursor_position.y, pressed, event_time);
      if (event.type === "action" && event.pressed) {
        this.rules_engine.click(this.cursor_position.x, this.cursor_position.y, event_time);
      }
      this.replay_event_index += 1;
    }
  }

  private updateReplayCursor(song_time: number): void {
    if (this.replay_aim_events.length === 0) return;
    while (this.replay_aim_index + 1 < this.replay_aim_events.length &&
      this.replay_aim_events[this.replay_aim_index + 1]!.time <= song_time) {
      this.replay_aim_index += 1;
    }
    const previous = this.replay_aim_events[this.replay_aim_index]!;
    const next = this.replay_aim_events[this.replay_aim_index + 1];
    if (!next || next.time <= previous.time) {
      this.cursor_position = { x: previous.x, y: previous.y };
      return;
    }
    const progress = Math.max(0, Math.min(1, (song_time - previous.time) / (next.time - previous.time)));
    this.cursor_position = {
      x: previous.x + (next.x - previous.x) * progress,
      y: previous.y + (next.y - previous.y) * progress,
    };
  }

  private flushPendingAim(performance_time: number, force: boolean): void {
    if (this.pending_aim === null) return;
    if (!force && performance_time - this.last_recorded_aim_performance_time < 1000 / 60) return;
    this.input_events.push(this.pending_aim);
    this.pending_aim = null;
    this.last_recorded_aim_performance_time = performance_time;
  }

  private playHitSounds(): void {
    while (this.played_judgment_events < this.rules_engine.judgment_events.length) {
      this.hit_sound_player.play(this.rules_engine.judgment_events[this.played_judgment_events++]!);
    }
  }
}
