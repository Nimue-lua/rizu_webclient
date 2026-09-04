import assert from "node:assert/strict";
import test from "node:test";
import type { OsuGameplayData } from "../src/library/GameplayLoader";
import { OsuGameplayRuntime, type OsuGameplayRuntimeDependencies } from "../src/gameplay/osu/OsuGameplayRuntime";
import { createOsuReplayBase } from "../src/replay/osu/OsuReplayBase";
import type { OsuCursorState } from "../src/gameplay/osu/OsuInputEvent";
import type { ScoreResult } from "../src/gameplay/scoring/ScoreResult";
import { replayTick, type CompletedGameplay, type OsuRecordedReplay } from "../src/replay/RecordedReplay";
import type { OsuHitObject } from "../src/chart/Chart";
import { createOsuAutoplayReplay } from "../src/gameplay/AutoplayReplay";

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

function createHarness(playback?: OsuRecordedReplay, autoplay = false, hit_objects?: readonly OsuHitObject[]) {
  const events = new FakeEventTarget();
  const frames = new FakeAnimationFrames();
  const cursor_states: OsuCursorState[] = [];
  const results: ScoreResult[] = [];
  const completions: CompletedGameplay[] = [];
  const reached_chart_end: boolean[] = [];
  let destroy_calls = 0;
  const cursor_renderers: string[] = [];
  const gain = { gain: { value: 1 }, connect() {}, disconnect() {} };
  const source_offsets: number[] = [];
  const source = { buffer: null, playbackRate: { value: 1 }, connect() {},
    start(_time: number, offset = 0) { source_offsets.push(offset); }, stop() {}, disconnect() {} };
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
      object_count: hit_objects?.length ?? 1, drain_length_seconds: 1, end_time: 10, primary_tempo: 120,
      slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [],
      hit_objects: hit_objects ?? [{ kind: "circle", x: 256, y: 192, absolute_time: 2, hit_sound: 0,
        hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" } }] },
    note_skin: {} as OsuGameplayData["note_skin"],
  };
  const dependencies: OsuGameplayRuntimeDependencies = {
    event_target: events as unknown as OsuGameplayRuntimeDependencies["event_target"],
    request_animation_frame: frames.request,
    cancel_animation_frame: frames.cancel,
    performance_now: () => 1000,
    create_renderer: (_canvas, _data, _replay_base, _cursor_scale, cursor_renderer) => {
      cursor_renderers.push(cursor_renderer);
      return {
      clientToPlayfield: (point, bounds) => ({ x: point.x - bounds.left, y: point.y - bounds.top }),
      draw: (_chart, _circle_states, _first_active_index, _transients, _time, _state, cursor) => {
        cursor_states.push(cursor);
        return { draw_calls: 1, command_count: 1, vertex_count: 6, buffer_upload_count: 1, slider_pass_count: 0 };
      },
      destroy: () => { destroy_calls += 1; },
      };
    },
  };
  const runtime_playback = playback ?? (autoplay ? createOsuAutoplayReplay(data.chart) : undefined);
  const runtime = new OsuGameplayRuntime({
    canvas: {} as HTMLCanvasElement,
    data,
    configuration: {
      master_volume: 0.5,
      hit_sound_volume: 1,
      music_offset: 0,
      cursor_scale: 1,
      cursor_renderer: "webgl",
      raw_input: false,
      hit_error_meter: { enabled: true, type: "normal", scale: 1 },
      replay_base: createOsuReplayBase(1, 5),
    },
    input_bindings: ["KeyZ", "KeyX"],
    finish: (completed, reached_end) => {
      completions.push(completed);
      reached_chart_end.push(reached_end);
      results.push(completed.score);
    },
    playback_replay: runtime_playback,
  }, dependencies);
  return { runtime, events, frames, cursor_states, cursor_renderers, source_offsets, results, completions, reached_chart_end,
    get destroy_calls() { return destroy_calls; } };
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

test("Space skips the osu intro to one second before the first object", () => {
  const object = { kind: "circle", x: 256, y: 192, absolute_time: 10, hit_sound: 0,
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" } } as const;
  const harness = createHarness(undefined, false, [object]);
  let prevented = false;
  harness.runtime.start();

  harness.events.dispatch("keydown", {
    code: "Space", timeStamp: 1000, repeat: false, preventDefault: () => { prevented = true; },
  } as KeyboardEvent);

  assert.equal(prevented, true);
  assert.deepEqual(harness.source_offsets, [0, 9]);
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

test("plays quantized osu aim and action events with the rendered replay cursor", () => {
  const playback: OsuRecordedReplay = {
    version: 1,
    mode: "osu",
    time_unit: "1/8192 second",
    input_events: [
      { type: "aim", time: replayTick(2), x: replayTick(256), y: replayTick(192) },
      { type: "action", time: replayTick(2), action: "primary", pressed: true },
      { type: "action", time: replayTick(2.01), action: "primary", pressed: false },
    ],
    judgment_events: [],
  };
  const harness = createHarness(playback);

  harness.runtime.start();
  assert.equal(harness.events.count("keydown"), 1);
  assert.equal(harness.events.count("keyup"), 0);
  harness.runtime.aimPointer(1, 0, 0, { left: 0, top: 0, width: 640, height: 480 }, 3000);
  harness.frames.run(3120);
  harness.frames.run(12300);

  assert.equal(harness.results[0]?.judges?.["300"], 1);
  assert.deepEqual(harness.cursor_states[0]?.position, { x: 256, y: 192 });
});

test("autoplay hits osu objects with its synthesized WebGL cursor", () => {
  const harness = createHarness(undefined, true);

  harness.runtime.start();
  assert.equal(harness.events.count("keyup"), 0);
  assert.deepEqual(harness.cursor_renderers, ["webgl"]);
  harness.frames.run(12300);

  assert.equal(harness.results[0]?.judges?.["300"], 1);
  assert.equal(harness.results[0]?.accuracy, 1);
  assert.deepEqual(harness.completions[0]?.replay.input_events, []);
});

test("autoplay follows osu sliders and completes spinners", () => {
  const base = { hit_sound: 0, hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    new_combo: false, combo_skip: 0, combo_number: 1, combo_color_index: 0 } as const;
  const harness = createHarness(undefined, true, [
    { ...base, kind: "slider", x: 100, y: 192, absolute_time: 1, curve_type: "linear",
      control_points: [{ x: 300, y: 192 }], repeat_count: 1, pixel_length: 200, edge_sounds: [], edge_sets: [],
      span_duration: 1, total_duration: 1, end_time: 2, tick_distances: [100] },
    { ...base, kind: "spinner", x: 256, y: 192, absolute_time: 3, end_time: 4 },
  ]);

  harness.runtime.start();
  harness.frames.run(12400);

  assert.equal(harness.results[0]?.misses ?? 0, 0);
  const replay = harness.completions[0]?.replay;
  assert.equal(replay?.mode, "osu");
  if (replay?.mode !== "osu") return;
  const slider_end = replay.judgment_events.find((event) => event.kind === "slider-end");
  const spinner_end = replay.judgment_events.find((event) => event.kind === "spinner-end");
  assert.ok(slider_end && slider_end.successful_parts === slider_end.total_parts,
    JSON.stringify(replay.judgment_events));
  assert.ok(spinner_end && spinner_end.rotations >= spinner_end.required_rotations);
});

test("Escape exits osu replay playback", () => {
  const playback: OsuRecordedReplay = {
    version: 1,
    mode: "osu",
    time_unit: "1/8192 second",
    input_events: [],
    judgment_events: [],
  };
  const harness = createHarness(playback);

  harness.runtime.start();
  harness.events.dispatch("keydown", key("Escape", 1200));

  assert.equal(harness.completions.length, 1);
});

test("linearly interpolates the replay cursor between aim samples", () => {
  const playback: OsuRecordedReplay = {
    version: 1,
    mode: "osu",
    time_unit: "1/8192 second",
    input_events: [
      { type: "aim", time: replayTick(1), x: replayTick(100), y: replayTick(300) },
      { type: "aim", time: replayTick(3), x: replayTick(300), y: replayTick(100) },
    ],
    judgment_events: [],
  };
  const harness = createHarness(playback);

  harness.runtime.start();
  harness.frames.run(3100);

  assert.deepEqual(harness.cursor_states[0]?.position, { x: 200, y: 200 });
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
  assert.deepEqual(harness.reached_chart_end, [false]);
});

test("Escape after the last osu object allows replay saving", () => {
  const harness = createHarness();
  harness.runtime.start();
  harness.events.dispatch("keydown", key("Escape", 11100));

  assert.deepEqual(harness.reached_chart_end, [true]);
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
