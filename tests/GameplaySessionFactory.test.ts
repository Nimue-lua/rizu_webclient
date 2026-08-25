import assert from "node:assert/strict";
import test from "node:test";
import type { ManiaGameplayData, OsuGameplayData } from "../src/library/GameplayLoader";
import { createGameplaySession, type GameplaySessionFactoryDependencies,
  type GameplaySessionOptions } from "../src/gameplay/createGameplaySession";
import type { GameplaySession, ManiaPointerInput, OsuPointerInput } from "../src/gameplay/GameplaySession";
import { ReplayBase } from "../src/replay/ReplayBase";

function createManiaData(): ManiaGameplayData {
  return {
    mode: "mania",
    audio_buffer: {} as AudioBuffer,
    audio_context: {} as AudioContext,
    chart: { mode: "mania", column_count: 1, primary_tempo: 120, notes: [], visual_points: [] },
    note_skin: {} as ManiaGameplayData["note_skin"],
  };
}

function createOsuData(): OsuGameplayData {
  return {
    mode: "osu",
    audio_buffer: {} as AudioBuffer,
    audio_context: {} as AudioContext,
    chart: { mode: "osu", approach_rate: 5, circle_size: 5, end_time: 1, overall_difficulty: 5,
      hp_drain_rate: 5, object_count: 0, drain_length_seconds: 0, primary_tempo: 120, circles: [] },
    note_skin: {} as OsuGameplayData["note_skin"],
  };
}

function createOptions(data: ManiaGameplayData | OsuGameplayData): GameplaySessionOptions {
  return {
    canvas: {} as HTMLCanvasElement,
    data,
    master_volume: 0.5,
    music_offset: 10,
    scroll_speed: 1.2,
    replay_base: new ReplayBase(),
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
