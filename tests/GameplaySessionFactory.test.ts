import assert from "node:assert/strict";
import test from "node:test";
import type { ManiaGameplayData, OsuGameplayData } from "../src/library/GameplayLoader";
import { createGameplaySession, type GameplaySessionFactoryDependencies,
  type GameplaySessionOptions } from "../src/gameplay/createGameplaySession";
import type { GameplaySession, ManiaPointerInput, OsuPointerInput } from "../src/gameplay/GameplaySession";
import { ManiaReplayBase } from "../src/replay/mania/ManiaReplayBase";
import type { CompletedGameplay } from "../src/replay/RecordedReplay";
import { createOsuReplayBase } from "../src/replay/osu/OsuReplayBase";

function createManiaData(): ManiaGameplayData {
  return {
    mode: "mania",
    chart_id: "mania-chart",
    audio_buffer: {} as AudioBuffer,
    audio_context: {} as AudioContext,
    chart: { mode: "mania", column_count: 1, primary_tempo: 120, notes: [], visual_points: [] },
    note_skin: {} as ManiaGameplayData["note_skin"],
  };
}

function createOsuData(): OsuGameplayData {
  return {
    mode: "osu",
    chart_id: "osu-chart",
    audio_buffer: {} as AudioBuffer,
    audio_context: {} as AudioContext,
    chart: { mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, end_time: 1, overall_difficulty: 5,
      hp_drain_rate: 5, object_count: 0, drain_length_seconds: 0, primary_tempo: 120,
      slider_multiplier: 1.4, slider_tick_rate: 1, combo_colors: [], timing_points: [], hit_objects: [] },
    note_skin: {} as OsuGameplayData["note_skin"],
  };
}

function createOptions(data: ManiaGameplayData | OsuGameplayData): GameplaySessionOptions {
  return {
    canvas: {} as HTMLCanvasElement,
    data,
    master_volume: 0.5,
    osu_hit_sound_volume: 0.75,
    music_offset: 10,
    scroll_speed: 1.2,
    cursor_scale: 1.25,
    osu_cursor_renderer: "webgl",
    osu_slider_renderer: "stable",
    replay_base: new ManiaReplayBase(),
    input_bindings: ["KeyA"],
    hit_registration: "nearest",
    finish: () => {},
  };
}

function createDependencies() {
  const mania_options: Array<GameplaySessionOptions & { data: ManiaGameplayData }> = [];
  const osu_options: Array<GameplaySessionOptions & { data: OsuGameplayData }> = [];
  const mania_sessions: Array<GameplaySession & ManiaPointerInput & { starts: number; destroys: number }> = [];
  const osu_sessions: Array<GameplaySession & OsuPointerInput & { starts: number; destroys: number }> = [];
  const dependencies: GameplaySessionFactoryDependencies = {
    create_mania: (options) => {
      mania_options.push(options);
      const session = {
        starts: 0,
        destroys: 0,
        start() { this.starts += 1; },
        destroy() { this.destroys += 1; },
        pressPointer() {},
        releasePointer() {},
      };
      mania_sessions.push(session);
      return session;
    },
    create_osu: (options) => {
      osu_options.push(options);
      const session = {
        starts: 0,
        destroys: 0,
        start() { this.starts += 1; },
        destroy() { this.destroys += 1; },
        aimPointer() {},
        pressPointer() {},
        releasePointer() {},
        cancelPointer() {},
      };
      osu_sessions.push(session);
      return session;
    },
  };
  return { dependencies, mania_options, osu_options, mania_sessions, osu_sessions };
}

test("creates a mania session with a separate narrowed pointer capability", () => {
  const harness = createDependencies();
  const options = createOptions(createManiaData());
  const binding = createGameplaySession(options, harness.dependencies);

  assert.equal(binding.mode, "mania");
  assert.equal(harness.mania_options.length, 1);
  assert.equal(harness.osu_options.length, 0);
  assert.equal(harness.mania_options[0]?.data, options.data);
  assert.deepEqual(harness.mania_options[0]?.replay_base.timings.toJSON(), { name: "osuod", data: 5 });
  assert.deepEqual(harness.mania_options[0]?.replay_base.subtimings?.toJSON(), { name: "scorev", data: 2 });
  assert.equal(harness.mania_options[0]?.replay_base.nearest, true);
  if (binding.mode === "mania") {
    assert.equal(binding.pointer_input, binding.session);
    binding.pointer_input.pressPointer(1, 0, 1000);
  }
});

test("creates an osu session without exposing mania column input", () => {
  const harness = createDependencies();
  const options = createOptions(createOsuData());
  const binding = createGameplaySession(options, harness.dependencies);

  assert.equal(binding.mode, "osu");
  assert.equal(harness.osu_options.length, 1);
  assert.equal(harness.mania_options.length, 0);
  assert.equal(harness.osu_options[0]?.data, options.data);
  assert.equal(harness.osu_options[0]?.replay_base.mode, "osu");
  assert.equal(harness.osu_options[0]?.replay_base.rate, options.replay_base.rate);
  assert.equal(harness.osu_options[0]?.cursor_scale, options.cursor_scale);
  assert.equal(harness.osu_options[0]?.osu_cursor_renderer, "webgl");
  assert.equal(harness.osu_options[0]?.osu_slider_renderer, "stable");
  assert.equal(harness.osu_options[0]?.osu_hit_sound_volume, 0.75);
  assert.deepEqual(harness.osu_options[0]?.replay_base.timings, { name: "osu_std_od", data: 5 });
  assert.deepEqual(harness.osu_options[0]?.replay_base.timing_values,
    { hit_300: 0.05, hit_100: 0.1, hit_50: 0.15, early_miss: 0.4, late_miss: 0.15 });
  assert.equal("subtimings" in harness.osu_options[0]!.replay_base, false);
  assert.equal("const" in harness.osu_options[0]!.replay_base, false);
  assert.equal(binding.pointer_input, binding.session);
});

test("each factory call creates an independently owned play attempt", () => {
  const harness = createDependencies();
  const options = createOptions(createManiaData());
  const first = createGameplaySession(options, harness.dependencies);
  const second = createGameplaySession(options, harness.dependencies);

  assert.notEqual(first.session, second.session);
  first.session.start();
  first.session.destroy();
  assert.equal(harness.mania_sessions[0]?.starts, 1);
  assert.equal(harness.mania_sessions[0]?.destroys, 1);
  assert.equal(harness.mania_sessions[1]?.starts, 0);
  assert.equal(harness.mania_sessions[1]?.destroys, 0);
});

test("uses recorded mania rules during replay playback", () => {
  const harness = createDependencies();
  const options = createOptions(createManiaData());
  const replay_base = new ManiaReplayBase();
  replay_base.rate = 1.5;
  replay_base.nearest = false;
  replay_base.tap_only = true;
  options.playback = {
    score: {},
    replay_base: replay_base.exportReplayBase(),
    replay: { version: 1, mode: "mania", time_unit: "1/8192 second", input_events: [], logic_events: [] },
  };

  createGameplaySession(options, harness.dependencies);

  assert.equal(harness.mania_options[0]?.replay_base.rate, 1.5);
  assert.equal(harness.mania_options[0]?.replay_base.tap_only, true);
  assert.equal(harness.mania_options[0]?.hit_registration, "earliest");
  assert.equal(harness.mania_options[0]?.playback_replay, options.playback.replay);
});

test("uses recorded osu rules and forces the WebGL cursor during playback", () => {
  const harness = createDependencies();
  const options = createOptions(createOsuData());
  options.osu_cursor_renderer = "os";
  const replay_base = createOsuReplayBase(1.75, 8);
  const playback: CompletedGameplay = {
    score: {},
    replay_base,
    replay: { version: 1, mode: "osu", time_unit: "1/8192 second", input_events: [], judgment_events: [] },
  };
  options.playback = playback;

  createGameplaySession(options, harness.dependencies);

  assert.equal(harness.osu_options[0]?.replay_base, replay_base);
  assert.equal(harness.osu_options[0]?.osu_cursor_renderer, "webgl");
  assert.equal(harness.osu_options[0]?.playback_replay, playback.replay);
});

test("generates a mania replay for autoplay", () => {
  const harness = createDependencies();
  const data = createManiaData();
  data.chart.notes = [{ column: 1, absolute_time: 1, weight: 0 }];
  const options = createOptions(data);
  options.autoplay = true;

  createGameplaySession(options, harness.dependencies);

  assert.deepEqual(harness.mania_options[0]?.playback_replay?.input_events, [
    { time: 8192, column: 0, pressed: true, note_index: 0, delta_time: 0 },
    { time: 8192, column: 0, pressed: false, note_index: 0, delta_time: null },
  ]);
});

test("generates an interpolated osu replay for autoplay", () => {
  const harness = createDependencies();
  const data = createOsuData();
  data.chart.hit_objects = [
    { kind: "circle", x: 100, y: 100, absolute_time: 0.5, hit_sound: 0,
      hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
      new_combo: false, combo_skip: 0, combo_number: 1, combo_color_index: 0 },
    { kind: "circle", x: 300, y: 200, absolute_time: 1, hit_sound: 0,
      hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
      new_combo: false, combo_skip: 0, combo_number: 2, combo_color_index: 0 },
  ];
  const options = createOptions(data);
  options.autoplay = true;
  options.osu_cursor_renderer = "os";

  createGameplaySession(options, harness.dependencies);

  assert.equal(harness.osu_options[0]?.osu_cursor_renderer, "webgl");
  const aims = harness.osu_options[0]?.playback_replay?.input_events.filter((event) => event.type === "aim");
  assert.deepEqual(aims, [
    { type: "aim", time: 4096, x: 819200, y: 819200 },
    { type: "aim", time: 8192, x: 2457600, y: 1638400 },
  ]);
});

test("rejects replay playback for a different gameplay mode", () => {
  const options = createOptions(createManiaData());
  options.playback = {
    score: {},
    replay_base: createOsuReplayBase(),
    replay: { version: 1, mode: "osu", time_unit: "1/8192 second", input_events: [], judgment_events: [] },
  };

  assert.throws(() => createGameplaySession(options, createDependencies().dependencies), /mode does not match/);
});
