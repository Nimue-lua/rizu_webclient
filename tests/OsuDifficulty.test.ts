import assert from "node:assert/strict";
import test from "node:test";
import type { OsuCircle, OsuHitObject, OsuSlider } from "../src/chart/Chart";
import { calculateOsuDifficulty, calculateOsuDifficultyAttributes } from "../src/gameplay/osu/scoring/OsuDifficulty";

const sample = { normal_set: 0, addition_set: 0, index: 0, volume: 0, filename: "" };

function circle(time_ms: number, x = 256, y = 192): OsuCircle {
  return {
    kind: "circle", x, y, absolute_time: time_ms / 1000, hit_sound: 0, hit_sample: sample,
    new_combo: false, combo_skip: 0, combo_number: null, combo_color_index: 0,
  };
}

function slider(time_ms: number, pixel_length: number, span_ms: number, repeat_count = 1): OsuSlider {
  return {
    ...circle(time_ms), kind: "slider", curve_type: "linear", control_points: [{ x: 400, y: 192 }],
    repeat_count, pixel_length, edge_sounds: [], edge_sets: [], span_duration: span_ms / 1000,
    total_duration: span_ms * repeat_count / 1000, end_time: (time_ms + span_ms * repeat_count) / 1000,
    tick_distances: [],
  };
}

function difficulty(hit_objects: readonly OsuHitObject[]): number {
  const end_time = hit_objects.reduce((end, object) => Math.max(end,
    object.kind === "circle" ? object.absolute_time : object.end_time), 0);
  return calculateOsuDifficulty({ end_time, hit_objects });
}

test("irregular rhythms rate above an evenly spaced pattern", () => {
  const even = [0, 500, 1000, 1500, 2000].map((time) => circle(time));
  const irregular = [0, 500, 750, 1250, 1375].map((time) => circle(time));
  assert.ok(difficulty(irregular) > difficulty(even));
});

test("fast jumps and spaced streams receive aim bonuses", () => {
  const slow_jumps = [circle(0, 0), circle(400, 300), circle(800, 0)];
  const fast_jumps = [circle(0, 0), circle(150, 300), circle(300, 0)];
  const stacked_stream = [0, 100, 200, 300].map((time) => circle(time, 256));
  const spaced_stream = [circle(0, 200), circle(100, 280), circle(200, 200), circle(300, 280)];
  assert.ok(difficulty(fast_jumps) > difficulty(slow_jumps));
  assert.ok(difficulty(spaced_stream) > difficulty(stacked_stream));
});

test("rapid notes rate as speed regardless of spacing", () => {
  const slow = Array.from({ length: 21 }, (_, index) => circle(index * 250));
  const fast_stacked = Array.from({ length: 21 }, (_, index) => circle(index * 100));
  const fast_spaced = Array.from({ length: 21 }, (_, index) => circle(index * 100, index % 2 ? 400 : 100));
  const attributes = (hit_objects: readonly OsuHitObject[]) =>
    calculateOsuDifficultyAttributes({ end_time: 120, hit_objects });

  assert.equal(attributes(slow).speed, 0);
  assert.equal(attributes(fast_stacked).speed, attributes(fast_spaced).speed);
  assert.ok(attributes(fast_stacked).speed > attributes(slow).speed);
});

test("spaced jumps rate as dexterity without an angle bonus", () => {
  const stacked = [circle(0), circle(150), circle(300)];
  const one_direction = [circle(0, 0, 0), circle(150, 150, 0), circle(300, 300, 0)];
  const square = [circle(0, 0, 0), circle(150, 150, 0), circle(300, 150, 150)];
  const attributes = (hit_objects: readonly OsuHitObject[]) =>
    calculateOsuDifficultyAttributes({ end_time: 120, hit_objects });

  assert.equal(attributes(stacked).dexterity, 0);
  assert.ok(attributes(one_direction).dexterity > 0);
  assert.ok(attributes(square).dexterity > attributes(one_direction).dexterity);
});

test("sustained spaced streams add aim-sync technical difficulty", () => {
  const stream = (count: number, spacing: number) => Array.from({ length: count }, (_, index) =>
    circle(index * 100, index % 2 ? 256 + spacing / 2 : 256 - spacing / 2));
  const attributes = (hit_objects: readonly OsuHitObject[]) =>
    calculateOsuDifficultyAttributes({ end_time: 120, hit_objects });
  const short_spaced = attributes(stream(5, 100));
  const long_stacked = attributes(stream(101, 20));
  const long_spaced = attributes(stream(101, 100));

  assert.equal(long_stacked.speed, long_spaced.speed);
  assert.ok(long_spaced.dexterity > short_spaced.dexterity);
  assert.ok(long_spaced.technical > short_spaced.technical * 1.5);
  assert.ok(long_spaced.technical > long_stacked.technical * 5);
});

test("awkward jump angles strain more than one-direction movement", () => {
  const one_direction = [circle(0, 0, 0), circle(200, 150, 0), circle(400, 300, 0)];
  const square = [circle(0, 0, 0), circle(200, 150, 0), circle(400, 150, 150)];
  const attributes = (hit_objects: readonly OsuHitObject[]) =>
    calculateOsuDifficultyAttributes({ end_time: 120, hit_objects });
  assert.ok(attributes(square).technical > attributes(one_direction).technical + 0.5);
});

test("square jump turns are more technical than triangle turns", () => {
  const square = [circle(0, 0, 0), circle(150, 150, 0), circle(300, 150, 150)];
  const triangle = [circle(0, 0, 0), circle(150, 150, 0), circle(300, 75, 130)];
  const attributes = (hit_objects: readonly OsuHitObject[]) =>
    calculateOsuDifficultyAttributes({ end_time: 120, hit_objects });

  assert.ok(attributes(square).technical > attributes(triangle).technical);
});

test("continuous streams build stamina strain", () => {
  const short_stream = Array.from({ length: 21 }, (_, index) => circle(index * 100));
  const long_stream = Array.from({ length: 601 }, (_, index) => circle(index * 100));
  assert.ok(difficulty(long_stream) > difficulty(short_stream) + 0.2);
});

test("stamina separates a sustained stream from a short burst at the same speed", () => {
  const burst = Array.from({ length: 11 }, (_, index) => circle(index * 100));
  const sustained = Array.from({ length: 301 }, (_, index) => circle(index * 100));
  const attributes = (hit_objects: readonly OsuHitObject[]) =>
    calculateOsuDifficultyAttributes({ end_time: 120, hit_objects });

  assert.ok(attributes(sustained).stamina > attributes(burst).stamina * 2);
});

test("stamina mostly recovers in five seconds and fully recovers in thirty", () => {
  const stream = (start: number) => Array.from({ length: 101 }, (_, index) => circle(start + index * 100));
  const continuous = [...stream(0), ...stream(10_100)];
  const five_second_break = [...stream(0), ...stream(15_000)];
  const thirty_second_break = [...stream(0), ...stream(40_000)];
  const fresh = stream(0);
  const stamina_difficulty = (hit_objects: readonly OsuHitObject[]) =>
    calculateOsuDifficulty({ end_time: 120, hit_objects });

  assert.ok(stamina_difficulty(continuous) > stamina_difficulty(five_second_break));
  assert.ok(stamina_difficulty(five_second_break) > stamina_difficulty(fresh));
  assert.ok(stamina_difficulty(thirty_second_break) < stamina_difficulty(five_second_break));
  assert.ok(stamina_difficulty(thirty_second_break) - stamina_difficulty(fresh) < 0.1);
});

test("discounts short charts by length", () => {
  const rating = (duration_seconds: number) => calculateOsuDifficulty({
    end_time: duration_seconds,
    hit_objects: [circle(0), circle(200, 300)],
  });
  const full = rating(120);
  assert.ok(Math.abs(rating(34.999) / full - 0.8 ** 1.8) < 1e-10);
  assert.ok(Math.abs(rating(35) / full - 0.85 ** 1.8) < 1e-10);
  assert.ok(Math.abs(rating(60) / full - 0.95 ** 1.8) < 1e-10);
  assert.equal(rating(120), full);
});

test("overall difficulty is a tight smooth maximum of the four skills", () => {
  const hit_objects = Array.from({ length: 101 }, (_, index) => circle(index * 100, index % 2 ? 400 : 100));
  const attributes = calculateOsuDifficultyAttributes({ end_time: 120, hit_objects });
  const skills = [attributes.speed, attributes.dexterity, attributes.stamina, attributes.technical];

  assert.ok(Math.abs(attributes.difficulty - skills.reduce((sum, skill) => sum + skill ** 6, 0) ** (1 / 6)) < 1e-10);
  assert.ok(attributes.difficulty >= Math.max(...skills));
  assert.ok(attributes.difficulty <= Math.max(...skills) * 4 ** (1 / 6));
});

test("long fast repeating sliders receive a large technical bonus", () => {
  const plain = difficulty([circle(0), circle(500)]);
  const technical = difficulty([circle(0), slider(500, 500, 250, 3)]);
  assert.ok(technical > plain + 2);
});

test("fast irregular rhythms rate as technical without adding stamina", () => {
  const regular = [0, 150, 300, 450, 600, 750, 900].map((time) => circle(time));
  const irregular = [0, 150, 250, 425, 500, 640, 730].map((time) => circle(time));
  const attributes = (hit_objects: readonly OsuHitObject[]) =>
    calculateOsuDifficultyAttributes({ end_time: 120, hit_objects });

  assert.ok(attributes(irregular).technical > attributes(regular).technical + 0.5);
});

test("skill scaling spreads high strain farther than low strain", () => {
  const moderate = Array.from({ length: 101 }, (_, index) => circle(index * 180));
  const extreme = Array.from({ length: 101 }, (_, index) => circle(index * 80));
  const attributes = (hit_objects: readonly OsuHitObject[]) =>
    calculateOsuDifficultyAttributes({ end_time: 120, hit_objects });

  assert.ok(attributes(extreme).stamina > attributes(moderate).stamina * 3);
});

test("fast repeating sliders rate above slow plain sliders in technical", () => {
  const slow = [circle(0), slider(500, 500, 1500)];
  const fast_repeating = [circle(0), slider(500, 500, 250, 3)];
  const attributes = (hit_objects: readonly OsuHitObject[]) =>
    calculateOsuDifficultyAttributes({ end_time: 120, hit_objects });

  assert.ok(attributes(fast_repeating).technical > attributes(slow).technical + 0.5);
});

test("keeps malformed negative slider lengths finite", () => {
  assert.ok(Number.isFinite(difficulty([slider(0, -100, 500)])));
});
