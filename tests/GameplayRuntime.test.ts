import assert from "node:assert/strict";
import test from "node:test";
import type { GameplayData, ManiaGameplayData } from "../src/library/GameplayLoader";
import { getAudioStartDelay, getGameplayEndTime } from "../src/gameplay/GameplayTiming";
import { ManiaGameplayRuntime, type ManiaGameplayRuntimeDependencies } from "../src/gameplay/mania/ManiaGameplayRuntime";
import { ManiaReplayBase } from "../src/replay/mania/ManiaReplayBase";
import type { ScoreResult } from "../src/gameplay/scoring/ScoreResult";
import { replayTick, type CompletedGameplay, type ManiaRecordedReplay } from "../src/replay/RecordedReplay";
import type { ManiaNoteEvent } from "../src/chart/Chart";
import { createManiaAutoplayReplay } from "../src/gameplay/AutoplayReplay";

function createData(note_times: readonly number[]): GameplayData {
  return {
    mode: "mania",
    audio_buffer: null as unknown as AudioBuffer,
    audio_context: null as unknown as AudioContext,
    chart: {
      mode: "mania",
      column_count: 1,
      primary_tempo: 120,
      notes: note_times.map((absolute_time) => ({ column: 1, absolute_time, weight: 0 })),
      visual_points: [],
    },
    note_skin: null as unknown as GameplayData["note_skin"],
  };
}

test("delays music to provide 1.2 seconds before an early first note", () => {
  assert.equal(getAudioStartDelay(createData([0.5, 1]), 1), 0.7);
});

test("accounts for playback rate when scheduling the lead-in", () => {
  assert.equal(getAudioStartDelay(createData([1]), 2), 0.7);
});

test("keeps the audio scheduling margin when the chart already has enough lead-in", () => {
  assert.equal(getAudioStartDelay(createData([2]), 1), 0.1);
  assert.equal(getAudioStartDelay(createData([]), 1), 0.1);
});

test("adds a loading transition to the initial lead-in", () => {
  assert.ok(Math.abs(getAudioStartDelay(createData([0.5]), 1, 1.15) - 1.85) < 1e-9);
});

test("ends 1.2 real seconds after the last note", () => {
  assert.equal(getGameplayEndTime(createData([1, 5, 3]), 1), 6.2);
  assert.equal(getGameplayEndTime(createData([1, 5, 3]), 2), 7.4);
  assert.equal(getGameplayEndTime(createData([1, 5, 3]), 0.5), 5.6);
});

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: object): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as Event);
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
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

  cancel = (id: number): void => {
    this.cancelled.push(id);
    this.callbacks.delete(id);
  };

  run(timestamp: number): void {
    const entry = this.callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
    assert.ok(entry, "No animation frame was scheduled");
    this.callbacks.delete(entry[0]);
    entry[1](timestamp);
  }
}

class FakeGain {
  readonly gain = { value: 1 };
  disconnect_calls = 0;

  connect(destination: AudioNode): AudioNode {
    return destination;
  }

  disconnect(): void {
    this.disconnect_calls += 1;
  }
}

class FakeSource {
  buffer: AudioBuffer | null = null;
  readonly playbackRate = { value: 1 };
  start_time: number | null = null;
  start_offset: number | null = null;
  stop_calls = 0;
  disconnect_calls = 0;

  connect(gain: GainNode): GainNode {
    return gain;
  }

  start(time: number, offset = 0): void {
    this.start_time = time;
    this.start_offset = offset;
  }

  stop(): void {
    this.stop_calls += 1;
  }

  disconnect(): void {
    this.disconnect_calls += 1;
  }
}

interface RuntimeHarness {
  runtime: ManiaGameplayRuntime;
  events: FakeEventTarget;
  frames: FakeAnimationFrames;
  source: FakeSource;
  gain: FakeGain;
  renderer: { draw_calls: number; destroy_calls: number };
  scores: ScoreResult[];
  completions: CompletedGameplay[];
  reached_chart_end: boolean[];
}

function createRuntime(notes: readonly ManiaNoteEvent[], options: {
  rate?: number;
  offset?: number;
  playback?: ManiaRecordedReplay;
  autoplay?: boolean;
} = {}): RuntimeHarness {
  const events = new FakeEventTarget();
  const frames = new FakeAnimationFrames();
  const source = new FakeSource();
  const gain = new FakeGain();
  const renderer = { draw_calls: 0, destroy_calls: 0 };
  const audio_context = {
    currentTime: 10,
    destination: {} as AudioDestinationNode,
    createGain: () => gain as unknown as GainNode,
    createBufferSource: () => source as unknown as AudioBufferSourceNode,
    getOutputTimestamp: () => ({ contextTime: 10, performanceTime: 1000 }),
    resume: async () => undefined,
  } as unknown as AudioContext;
  const data: ManiaGameplayData = {
    mode: "mania",
    chart_id: "test-mania-chart",
    audio_buffer: {} as AudioBuffer,
    audio_context,
    chart: {
      mode: "mania",
      column_count: 1,
      overall_difficulty: 5,
      primary_tempo: 120,
      notes,
      visual_points: [{ absolute_time: 0, visual_time: 0, current_speed: 1, local_speed: 1, global_speed: 1 }],
    },
    note_skin: {} as ManiaGameplayData["note_skin"],
  };
  const replay = new ManiaReplayBase();
  replay.rate = options.rate ?? 1;
  const scores: ScoreResult[] = [];
  const completions: CompletedGameplay[] = [];
  const reached_chart_end: boolean[] = [];
  const dependencies: ManiaGameplayRuntimeDependencies = {
    event_target: events as unknown as ManiaGameplayRuntimeDependencies["event_target"],
    request_animation_frame: frames.request,
    cancel_animation_frame: frames.cancel,
    performance_now: () => 1000,
    create_renderer: () => ({
      getTimeRange: () => ({ past: 2, future: 2 }),
      draw: () => { renderer.draw_calls += 1; return { draw_calls: 1, command_count: 1,
        vertex_count: 6, buffer_upload_count: 1, slider_pass_count: 0 }; },
      destroy: () => { renderer.destroy_calls += 1; },
    }),
  };
  const playback = options.playback ?? (options.autoplay ? createManiaAutoplayReplay(data.chart, replay.tap_only) : undefined);
  const runtime = new ManiaGameplayRuntime({} as HTMLCanvasElement, data, 0.6, options.offset ?? 0, 2,
    true, "normal", 1, replay, ["KeyA"], "earliest", (completed, reached_end) => {
      completions.push(completed);
      reached_chart_end.push(reached_end);
      scores.push(completed.score);
    }, dependencies, playback);
  return { runtime, events, frames, source, gain, renderer, scores, completions, reached_chart_end };
}

function key(code: string, timeStamp: number, repeat = false): KeyboardEvent {
  return { code, timeStamp, repeat, preventDefault() {} } as KeyboardEvent;
}

test("runs a deterministic mania tap and hold session through completion", () => {
  const harness = createRuntime([
    { column: 1, absolute_time: 0.5, weight: 0 },
    { column: 1, absolute_time: 1, weight: 1 },
    { column: 1, absolute_time: 1.5, weight: -1 },
  ]);

  harness.runtime.start();
  assert.equal(harness.source.start_time, 10.7);
  assert.equal(harness.source.playbackRate.value, 1);
  assert.equal(harness.events.count("keydown"), 1);
  assert.equal(harness.events.count("keyup"), 1);

  harness.frames.run(1000);
  harness.events.dispatch("keydown", key("KeyA", 2200));
  harness.events.dispatch("keyup", key("KeyA", 2201));
  harness.events.dispatch("keydown", key("KeyA", 2700));
  harness.events.dispatch("keyup", key("KeyA", 3200));
  harness.frames.run(4400);

  assert.equal(harness.scores.length, 1);
  assert.equal(harness.scores[0]?.judges?.perfect, 3);
  assert.equal(harness.scores[0]?.judges?.miss, 0);
  assert.equal(harness.scores[0]?.accuracy, 1);
  assert.deepEqual(harness.reached_chart_end, [true]);
  assert.equal(harness.frames.callbacks.size, 0);
  assert.equal(harness.renderer.draw_calls, 2);
  assert.deepEqual(harness.completions[0]?.replay.mode, "mania");
  assert.deepEqual(harness.completions[0]?.replay.input_events, [
    { time: 4096, column: 0, pressed: true, note_index: 0, delta_time: 0 },
    { time: 4104, column: 0, pressed: false, note_index: 0, delta_time: null },
    { time: 8192, column: 0, pressed: true, note_index: 1, delta_time: 0 },
    { time: 12288, column: 0, pressed: false, note_index: 1, delta_time: 0 },
  ]);
});

test("applies rate and offset to runtime input timestamps", () => {
  const harness = createRuntime([{ column: 1, absolute_time: 1, weight: 0 }], { rate: 2, offset: 200 });
  harness.runtime.start();

  assert.equal(harness.source.start_time, 10.7);
  assert.equal(harness.source.playbackRate.value, 2);
  harness.events.dispatch("keydown", key("KeyA", 2000));
  harness.frames.run(3200);

  assert.equal(harness.scores[0]?.judges?.perfect, 1);
  assert.equal(harness.scores[0]?.accuracy, 1);
});

test("plays quantized mania press and release events without live input listeners", () => {
  const playback: ManiaRecordedReplay = {
    version: 1,
    mode: "mania",
    time_unit: "1/8192 second",
    input_events: [
      { time: replayTick(0.5), column: 0, pressed: true, note_index: 0, delta_time: 0 },
      { time: replayTick(1), column: 0, pressed: false, note_index: 0, delta_time: 0 },
    ],
    logic_events: [],
  };
  const harness = createRuntime([
    { column: 1, absolute_time: 0.5, weight: 1 },
    { column: 1, absolute_time: 1, weight: -1 },
  ], { playback });

  harness.runtime.start();
  assert.equal(harness.events.count("keydown"), 1);
  assert.equal(harness.events.count("keyup"), 0);
  harness.runtime.pressPointer(1, 0, 2200);
  harness.frames.run(2200);
  harness.frames.run(3900);

  assert.equal(harness.scores[0]?.judges?.perfect, 2);
  assert.equal(harness.scores[0]?.accuracy, 1);
});

test("autoplay hits mania taps and holds at exact chart times", () => {
  const harness = createRuntime([
    { column: 1, absolute_time: 0.5, weight: 0 },
    { column: 1, absolute_time: 1, weight: 1 },
    { column: 1, absolute_time: 1.5, weight: -1 },
  ], { autoplay: true });

  harness.runtime.start();
  assert.equal(harness.events.count("keyup"), 0);
  harness.frames.run(4400);

  assert.equal(harness.scores[0]?.judges?.perfect, 3);
  assert.equal(harness.scores[0]?.accuracy, 1);
  assert.deepEqual(harness.completions[0]?.replay.input_events, []);
});

test("Escape exits mania replay playback", () => {
  const playback: ManiaRecordedReplay = {
    version: 1,
    mode: "mania",
    time_unit: "1/8192 second",
    input_events: [],
    logic_events: [],
  };
  const harness = createRuntime([{ column: 1, absolute_time: 1, weight: 0 }], { playback });

  harness.runtime.start();
  harness.events.dispatch("keydown", key("Escape", 1200));

  assert.equal(harness.completions.length, 1);
});

test("prevents browser shortcuts for repeated gameplay keys", () => {
  const harness = createRuntime([{ column: 1, absolute_time: 1, weight: 0 }]);
  let prevented = false;
  harness.runtime.start();

  harness.events.dispatch("keydown", {
    code: "KeyA",
    timeStamp: 2000,
    repeat: true,
    preventDefault: () => { prevented = true; },
  } as unknown as KeyboardEvent);

  assert.equal(prevented, true);
});

test("Space skips the mania intro to one second before the first note", () => {
  const harness = createRuntime([{ column: 1, absolute_time: 10, weight: 0 }]);
  let prevented = false;
  harness.runtime.start();

  harness.events.dispatch("keydown", {
    code: "Space", timeStamp: 1000, repeat: false, preventDefault: () => { prevented = true; },
  } as KeyboardEvent);

  assert.equal(prevented, true);
  assert.equal(harness.source.start_offset, 9);
});

test("Escape releases held input, misses the remaining chart, and finishes once", () => {
  const harness = createRuntime([
    { column: 1, absolute_time: 1, weight: 1 },
    { column: 1, absolute_time: 2, weight: -1 },
    { column: 1, absolute_time: 3, weight: 0 },
  ]);
  harness.runtime.start();
  harness.events.dispatch("keydown", key("KeyA", 2200));
  harness.events.dispatch("keydown", key("Escape", 2700));
  harness.events.dispatch("keydown", key("Escape", 2800));

  assert.equal(harness.scores.length, 1);
  assert.equal(harness.scores[0]?.judges?.perfect, 1);
  assert.equal(harness.scores[0]?.judges?.miss, 3);
  assert.deepEqual(harness.reached_chart_end, [false]);
});

test("Escape after the last mania note allows replay saving", () => {
  const harness = createRuntime([{ column: 1, absolute_time: 1, weight: 0 }]);
  harness.runtime.start();
  harness.events.dispatch("keydown", key("Escape", 3100));

  assert.deepEqual(harness.reached_chart_end, [true]);
});

test("destroy releases listeners, animation, audio, gain, and renderer exactly once", () => {
  const harness = createRuntime([{ column: 1, absolute_time: 1, weight: 0 }]);
  harness.runtime.start();
  const scheduled_frame = harness.frames.callbacks.keys().next().value as number;

  harness.runtime.destroy();
  harness.runtime.destroy();

  assert.equal(harness.events.count("keydown"), 0);
  assert.equal(harness.events.count("keyup"), 0);
  assert.deepEqual(harness.frames.cancelled, [scheduled_frame]);
  assert.equal(harness.source.stop_calls, 1);
  assert.equal(harness.source.disconnect_calls, 1);
  assert.equal(harness.gain.disconnect_calls, 1);
  assert.equal(harness.renderer.destroy_calls, 1);
});
