import type { OsuGameplayData } from "../library/GameplayLoader";
import type { OsuReplayBaseValues } from "../replay/ReplayBase";
import { AudioGameplayClock } from "./AudioGameplayClock";
import type { GameplaySession, OsuPointerInput } from "./GameplaySession";
import { getAudioStartDelay, getGameplayEndTime } from "./GameplayTiming";
import { HudStateDeriver } from "./HudState";
import type { OsuAction, OsuCursorState, OsuInputEvent } from "./OsuInputEvent";
import type { OsuStandardJudgmentEvent } from "./OsuStandardJudgmentEvent";
import { WebAudioPlayback } from "./audio/WebAudioPlayback";
import { OsuRenderer, type OsuGameplayRenderer } from "./renderer/OsuRenderer";
import { ScoreEngine } from "./scoring/ScoreEngine";
import { calculateOsuStandardDifficultyMultiplier } from "./scoring/OsuStandardDifficulty";
import type { ScoreResult } from "./scoring/ScoreResult";
import { OsuStandardScore } from "./scoring/systems/OsuStandardScore";
import { resolveOsuStandardTimingValues } from "./timing/TimingValuesFactory";
import { Timings } from "./timing/Timings";

export interface OsuGameplayRuntimeDependencies {
  event_target: Pick<Window, "addEventListener" | "removeEventListener">;
  request_animation_frame: (callback: FrameRequestCallback) => number;
  cancel_animation_frame: (handle: number) => void;
  performance_now: () => number;
  create_renderer: (canvas: HTMLCanvasElement, data: OsuGameplayData,
    replay_base: OsuReplayBaseValues) => OsuGameplayRenderer;
}

function createDefaultDependencies(): OsuGameplayRuntimeDependencies {
  return {
    event_target: window,
    request_animation_frame: (callback) => window.requestAnimationFrame(callback),
    cancel_animation_frame: (handle) => window.cancelAnimationFrame(handle),
    performance_now: () => performance.now(),
    create_renderer: (canvas, data, replay_base) => new OsuRenderer(canvas, data.note_skin, undefined,
      replay_base.x_flip, replay_base.y_flip),
  };
}

export class OsuGameplayRuntime implements GameplaySession, OsuPointerInput {
  readonly input_events: OsuInputEvent[] = [];
  private readonly renderer: OsuGameplayRenderer;
  private readonly playback: WebAudioPlayback;
  private readonly clock: AudioGameplayClock;
  private readonly music_rate: number;
  private readonly hud_state = new HudStateDeriver();
  private readonly score_engine: ScoreEngine<OsuStandardJudgmentEvent>;
  private readonly dependencies: OsuGameplayRuntimeDependencies;
  private readonly key_actions = new Map<string, OsuAction>();
  private readonly pressed_keys = new Set<string>();
  private readonly pointer_actions = new Map<number, Set<OsuAction>>();
  private readonly action_sources = { primary: 0, secondary: 0 };
  private cursor_position = { x: 256, y: 192 };
  private animation_frame: number | null = null;
  private finished = false;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, private readonly data: OsuGameplayData,
    master_volume: number, music_offset: number, replay_base: OsuReplayBaseValues,
    input_bindings: readonly (string | null)[], private readonly finish: (score: ScoreResult) => void,
    dependencies: OsuGameplayRuntimeDependencies = createDefaultDependencies()) {
    this.dependencies = dependencies;
    this.renderer = dependencies.create_renderer(canvas, data, replay_base);
    this.music_rate = replay_base.rate;
    const timing_configuration = resolveOsuStandardTimingValues(Timings.fromValue(replay_base.timings));
    const chart = data.chart;
    const difficulty_multiplier = calculateOsuStandardDifficultyMultiplier(chart.hp_drain_rate,
      replay_base.overall_difficulty ?? chart.overall_difficulty ?? 5,
      replay_base.circle_size ?? chart.circle_size, chart.object_count, chart.drain_length_seconds);
    this.score_engine = new ScoreEngine([
      new OsuStandardScore(timing_configuration.values, difficulty_multiplier),
    ]);
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

  aimPointer(_pointer_id: number, client_x: number, client_y: number,
    bounds: { left: number; top: number; width: number; height: number }, performance_time: number): void {
    const position = this.renderer.clientToPlayfield({ x: client_x, y: client_y }, bounds);
    this.cursor_position = position;
    const time = this.clock.timeAt(performance_time).corrected;
    this.input_events.push({ type: "aim", time, x: position.x, y: position.y });
  }

  pressPointer(pointer_id: number, action: OsuAction, performance_time: number): void {
    const actions = this.pointer_actions.get(pointer_id) ?? new Set<OsuAction>();
    if (actions.has(action)) return;
    actions.add(action);
    this.pointer_actions.set(pointer_id, actions);
    this.changeAction(action, true, performance_time);
  }

  releasePointer(pointer_id: number, action: OsuAction, performance_time: number): void {
    const actions = this.pointer_actions.get(pointer_id);
    if (!actions?.delete(action)) return;
    if (actions.size === 0) this.pointer_actions.delete(pointer_id);
    this.changeAction(action, false, performance_time);
  }

  cancelPointer(pointer_id: number, performance_time: number): void {
    const actions = this.pointer_actions.get(pointer_id);
    if (!actions) return;
    this.pointer_actions.delete(pointer_id);
    for (const action of actions) this.changeAction(action, false, performance_time);
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.code === "Escape") {
      this.finishGameplay();
      return;
    }
    const action = this.key_actions.get(event.code);
    if (action === undefined) return;
    event.preventDefault();
    if (event.repeat || this.pressed_keys.has(event.code)) return;
    this.pressed_keys.add(event.code);
    this.changeAction(action, true, event.timeStamp);
  };

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
    this.input_events.push({ type: "action", time: this.clock.timeAt(performance_time).corrected,
      action, pressed: current > 0 });
  }

  private finishGameplay(): void {
    if (this.finished) return;
    this.finished = true;
    this.finish(this.score_engine.getResult());
  }

  private readonly render = (timestamp: number) => {
    const song_time = this.clock.timeAt(timestamp).monotonic;
    this.renderer.draw(this.data.chart, song_time,
      this.hud_state.update(this.score_engine.getResult(), timestamp / 1000), this.cursor_state);
    if (song_time >= getGameplayEndTime(this.data, this.music_rate)) {
      this.finishGameplay();
      return;
    }
    this.animation_frame = this.dependencies.request_animation_frame(this.render);
  };
}
