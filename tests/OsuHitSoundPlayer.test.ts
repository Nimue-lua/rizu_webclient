import assert from "node:assert/strict";
import test from "node:test";
import type { OsuChart, OsuHitObject } from "../src/chart/Chart";
import { OsuHitSoundPlayer } from "../src/gameplay/osu/audio/OsuHitSoundPlayer";
import type { OsuStandardSkin } from "../src/gameplay/renderer/OsuSkin";
import { createOsuStandardTimingValues } from "../src/gameplay/osu/timing/OsuStandardOdTimings";

function chart(hit_objects: readonly OsuHitObject[]): OsuChart {
  return {
    mode: "osu", format_version: 14, approach_rate: 5, circle_size: 5, end_time: 2,
    overall_difficulty: 5, hp_drain_rate: 5, object_count: hit_objects.length, drain_length_seconds: 1,
    primary_tempo: 120, slider_multiplier: 1.4, slider_tick_rate: 1, sample_set: 1, combo_colors: [],
    timing_points: [{ absolute_time: 0, beat_length: 0.5, uninherited: true, slider_velocity: 1,
      sample_set: 2, sample_index: 0, volume: 50 }],
    hit_objects,
  };
}

const common = {
  x: 256, y: 192, absolute_time: 1, new_combo: false, combo_skip: 0, combo_number: 1, combo_color_index: 0,
};

function createHarness(hit_objects: readonly OsuHitObject[], layered = true) {
  const buffers = Object.fromEntries(["soft-hitnormal", "drum-hitclap", "drum-hitfinish", "soft-slidertick"]
    .map((name) => [name, { name } as unknown as AudioBuffer]));
  const played: { name: string; volume: number }[] = [];
  let current_gain = 1;
  const audio_context = {
    destination: {},
    createGain: () => ({ gain: { get value() { return current_gain; }, set value(value: number) { current_gain = value; } },
      connect() {}, disconnect() {} }),
    createBufferSource: () => ({ buffer: null as AudioBuffer | null, onended: null as (() => void) | null,
      connect() {}, disconnect() {}, stop() {}, start() {
        played.push({ name: (this.buffer as unknown as { name: string }).name, volume: current_gain });
      } }),
  } as unknown as AudioContext;
  const skin = { hitSounds: buffers, layeredHitSounds: layered } as unknown as OsuStandardSkin;
  return { played, player: new OsuHitSoundPlayer(audio_context, chart(hit_objects), skin, 0.5,
    createOsuStandardTimingValues(5)) };
}

test("plays layered object samples using timing and addition sets", () => {
  const object: OsuHitObject = { kind: "circle", ...common, hit_sound: 8,
    hit_sample: { normal_set: 0, addition_set: 3, index: 4, volume: 0, filename: "unavailable.wav" } };
  const { player, played } = createHarness([object]);
  player.play({ kind: "hit", object_index: 0, time: 1, delta_time: 0 });
  assert.deepEqual(played.map((sound) => sound.name), ["soft-hitnormal", "drum-hitclap"]);
  assert.ok(Math.abs(played[0]!.volume - 0.2) < 1e-12);
  assert.ok(Math.abs(played[1]!.volume - 0.2125) < 1e-12);
});

test("respects LayeredHitSounds and does not play misses", () => {
  const object: OsuHitObject = { kind: "circle", ...common, hit_sound: 4,
    hit_sample: { normal_set: 0, addition_set: 3, index: 0, volume: 100, filename: "" } };
  const { player, played } = createHarness([object], false);
  player.play({ kind: "hit", object_index: 0, time: 1, delta_time: 0 });
  player.play({ kind: "hit", object_index: 0, time: 1.2, delta_time: 0.2 });
  assert.deepEqual(played.map((sound) => sound.name), ["drum-hitfinish"]);
});

test("uses slider edge sounds and the normal set for ticks", () => {
  const object: OsuHitObject = { kind: "slider", ...common, hit_sound: 0,
    hit_sample: { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" },
    curve_type: "linear", control_points: [{ x: 356, y: 192 }], repeat_count: 2, pixel_length: 100,
    edge_sounds: [0, 8, 4], edge_sets: [{ normal_set: 0, addition_set: 0 },
      { normal_set: 0, addition_set: 3 }, { normal_set: 0, addition_set: 3 }],
    span_duration: 0.5, total_duration: 1, end_time: 2, tick_distances: [50] };
  const { player, played } = createHarness([object]);
  player.play({ kind: "slider-point", point_kind: "tick", object_index: 0, time: 1.25, successful: true });
  player.play({ kind: "slider-point", point_kind: "repeat", object_index: 0, time: 1.5, successful: true });
  assert.deepEqual(played.map((sound) => sound.name), ["soft-slidertick", "soft-hitnormal", "drum-hitclap"]);
});
