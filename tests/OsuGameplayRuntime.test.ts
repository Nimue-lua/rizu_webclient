import assert from "node:assert/strict";
import test from "node:test";
import type { OsuGameplayData } from "../src/library/GameplayLoader";
import { OsuGameplayRuntime, type OsuGameplayRuntimeDependencies } from "../src/gameplay/osu/OsuGameplayRuntime";
import { createOsuReplayBase } from "../src/replay/osu/OsuReplayBase";
import type { OsuCursorState } from "../src/gameplay/osu/OsuInputEvent";
import type { ScoreResult } from "../src/gameplay/scoring/ScoreResult";
import type { CompletedGameplay } from "../src/replay/RecordedReplay";

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();
  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: EventListener): void { this.listeners.get(type)?.delete(listener); }
  dispatch(type: string, event: object): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as Event);
  }
  count(type: string): number { return this.listeners.get(type)?.size ?? 0; }
}

class FakeAnimationFrames {
  private next_id = 1;
  readonly callbacks = new Map<number, FrameRequestCallback>();
  readonly cancelled: number[] = [];
  request = (callback: FrameRequestCallback): number => {
    const id = this.next_id++;
    this.callbacks.set(id, callback);
    return id;
  };
  cancel = (id: number): void => { this.cancelled.push(id); this.callbacks.delete(id); };
  run(timestamp: number): void {
    const entry = this.callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
    assert.ok(entry);
    this.callbacks.delete(entry[0]);
    entry[1](timestamp);
  }
}

function key(code: string, timeStamp: number, repeat = false): KeyboardEvent {
  return { code, timeStamp, repeat, preventDefault() {} } as KeyboardEvent;
}

function createHarness() {
  const events = new FakeEventTarget();
  const frames = new FakeAnimationFrames();
  const cursor_states: OsuCursorState[] = [];
  const results: ScoreResult[] = [];
  const completions: CompletedGameplay[] = [];
  let destroy_calls = 0;
  const gain = { gain: { value: 1 }, connect() {}, disconnect() {} };
  const source = { buffer: null, playbackRate: { value: 1 }, connect() {}, start() {}, stop() {}, disconnect() {} };
  const audio_context = {
    currentTime: 10,
    destination: {},
    createGain: () => gain,
    createBufferSource: () => source,
    getOutputTimestamp: () => ({ contextTime: 10, performanceTime: 1000 }),
    resume: async () => undefined,
  } as unknown as AudioContext;
  const data: OsuGameplayData = {
    mode: "osu", chart_id: "test-osu-chart", audio_buffer: {} as AudioBuffer, audio_context,
    chart: { mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, overall_difficulty: 5, hp_drain_rate: 5,
      object_count: 1, drain_length_seconds: 1, end_time: 10, primary_tempo: 120,
      slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [],
      hit_objects: [{ kind: "circle", x: 256, y: 192, absolute_time: 2, hit_sound: 0,
        hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" } }] },
    note_skin: {} as OsuGameplayData["note_skin"],
  };
  const dependencies: OsuGameplayRuntimeDependencies = {
    event_target: events as unknown as OsuGameplayRuntimeDependencies["event_target"],
    request_animation_frame: frames.request,
    cancel_animation_frame: frames.cancel,
    performance_now: () => 1000,
    create_renderer: () => ({
      clientToPlayfield: (point, bounds) => ({ x: point.x - bounds.left, y: point.y - bounds.top }),
      draw: (_chart, _circle_states, _first_active_index, _transients, _time, _state, cursor) => cursor_states.push(cursor),
      destroy: () => { destroy_calls += 1; },
    }),
  };
  const runtime = new OsuGameplayRuntime({} as HTMLCanvasElement, data, 0.5, 1, 0,
    1, "webgl", createOsuReplayBase(1, 5), "direct", ["KeyZ", "KeyX"], (completed) => {
      completions.push(completed);
      results.push(completed.score);
    }, dependencies);
  return { runtime, events, frames, cursor_states, results, completions, get destroy_calls() { return destroy_calls; } };
}

test("records aim and actions at corrected event time between render frames", () => {
  const harness = createHarness();
  harness.runtime.start();
  harness.frames.run(1000);
  harness.runtime.aimPointer(1, 110, 220, { left: 10, top: 20, width: 640, height: 480 }, 1250);
  harness.runtime.pressPointer(1, "primary", 1260);
  assert.deepEqual(harness.runtime.input_events.map(({ time: _time, ...event }) => event), [
    { type: "aim", x: 100, y: 200 },
    { type: "action", action: "primary", pressed: true },
  ]);
  assert.ok(Math.abs(harness.runtime.input_events[0]!.time - 0.15) < 1e-12);
  assert.ok(Math.abs(harness.runtime.input_events[1]!.time - 0.16) < 1e-12);
  assert.deepEqual(harness.runtime.cursor_state, { position: { x: 100, y: 200 }, primary: true, secondary: false });
});

test("samples only the latest osu aim position at up to 60 FPS", () => {
  const harness = createHarness();
  const bounds = { left: 0, top: 0, width: 640, height: 480 };
  harness.runtime.start();
  harness.frames.run(1000);

  harness.runtime.aimPointer(1, 100, 100, bounds, 1005);
  harness.runtime.aimPointer(1, 200, 200, bounds, 1010);
  harness.frames.run(1016);
  harness.runtime.aimPointer(1, 300, 300, bounds, 1020);
  harness.frames.run(1025);
  harness.frames.run(1033);

  assert.deepEqual(harness.runtime.input_events.map(({ time: _time, ...event }) => event), [
    { type: "aim", x: 200, y: 200 },
    { type: "aim", x: 300, y: 300 },
  ]);
});

test("keeps an action pressed while another input source still holds it", () => {
  const harness = createHarness();
  harness.runtime.start();
  harness.runtime.pressPointer(1, "primary", 1100);
  harness.events.dispatch("keydown", key("KeyZ", 1200));
  harness.runtime.releasePointer(1, "primary", 1300);
  assert.equal(harness.runtime.cursor_state.primary, true);
  harness.events.dispatch("keyup", key("KeyZ", 1400));
  assert.equal(harness.runtime.cursor_state.primary, false);
  assert.deepEqual(harness.runtime.input_events.filter((event) => event.type === "action").map((event) => event.pressed), [true, false]);
});

test("tracks both mouse buttons independently on one pointer", () => {
  const harness = createHarness();
  harness.runtime.start();
  harness.runtime.pressPointer(1, "primary", 1100);
  harness.runtime.pressPointer(1, "secondary", 1200);
  harness.runtime.releasePointer(1, "primary", 1300);
  assert.deepEqual(harness.runtime.cursor_state, {
    position: { x: 256, y: 192 }, primary: false, secondary: true,
  });
  harness.runtime.cancelPointer(1, 1400);
  assert.equal(harness.runtime.cursor_state.secondary, false);
});

test("cancels pointer actions and renders the current cursor state", () => {
  const harness = createHarness();
  harness.runtime.start();
  harness.runtime.pressPointer(7, "secondary", 1100);
  harness.runtime.cancelPointer(7, 1200);
  harness.frames.run(1300);
  assert.equal(harness.runtime.cursor_state.secondary, false);
  assert.deepEqual(harness.cursor_states[0], harness.runtime.cursor_state);
});

test("feeds corrected circle clicks into osu scoring and renderer state", () => {
  const harness = createHarness();
  harness.runtime.start();
  harness.runtime.aimPointer(1, 256, 192, { left: 0, top: 0, width: 640, height: 480 }, 3100);
  harness.runtime.pressPointer(1, "primary", 3100);
  harness.frames.run(3100);
  harness.events.dispatch("keydown", key("Escape", 3200));

  assert.equal(harness.results[0]?.judges?.["300"], 1);
  assert.equal(harness.cursor_states.length, 1);
  const replay = harness.completions[0]?.replay;
  assert.equal(replay?.mode, "osu");
  assert.deepEqual(replay?.input_events, [
    { type: "aim", time: 16384, x: 2097152, y: 1572864 },
    { type: "action", time: 16384, action: "primary", pressed: true },
  ]);
});

test("registers and cleans up keyboard, animation, audio, and renderer resources", () => {
  const harness = createHarness();
  harness.runtime.start();
  assert.equal(harness.events.count("keydown"), 1);
  assert.equal(harness.events.count("keyup"), 1);
  harness.runtime.destroy();
  harness.runtime.destroy();
  assert.equal(harness.events.count("keydown"), 0);
  assert.equal(harness.events.count("keyup"), 0);
  assert.equal(harness.destroy_calls, 1);
  assert.equal(harness.frames.cancelled.length, 1);
});
