import assert from "node:assert/strict";
import test from "node:test";
import { resolveOsuStandardTimingValues, resolveTimingValues } from "../src/gameplay/timing/TimingValuesFactory";
import { Subtimings } from "../src/gameplay/timing/Subtimings";
import { Timings } from "../src/gameplay/timing/Timings";
import { createOsuStandardTimingValues } from "../src/gameplay/osu/timing/OsuStandardOdTimings";

test("preserves native timing integer encodings", () => {
  assert.equal(new Timings("arbitrary").encode(), 0);
  assert.equal(new Timings("sphere").encode(), 100);
  assert.equal(new Timings("simple", 0.123).encode(), 1123);
  assert.equal(new Timings("osuod", 7.5).encode(), 2175);
  assert.equal(new Timings("etternaj", 4).encode(), 2304);
  assert.equal(new Timings("quaver").encode(), 2400);
  assert.equal(new Timings("bmsrank", 3).encode(), 2503);
  assert.equal(new Timings("osu_std_od", 7.5).encode(), 2675);

  for (let value = -1; value <= 3000; value += 1) {
    assert.equal(Timings.decode(value).encode(), value);
  }
});

test("validates timing identity ranges and precision", () => {
  assert.throws(() => new Timings("simple", 0.0001), /Invalid timings/);
  assert.throws(() => new Timings("simple", 1.001), /Invalid timings/);
  assert.throws(() => new Timings("osuod", 5.05), /Invalid timings/);
  assert.throws(() => new Timings("osuod", -0.1), /Invalid timings/);
  assert.throws(() => new Timings("osuod", 10.1), /Invalid timings/);
  assert.throws(() => new Timings("osu_std_od", 5.05), /Invalid timings/);
  assert.throws(() => new Timings("osu_std_od", 10.1), /Invalid timings/);
  assert.throws(() => new Timings("etternaj", 1.5), /Invalid timings/);
  assert.throws(() => Timings.decode(1.5), /integer/);
});

test("compares and formats timing identities stably", () => {
  const timings = new Timings("osuod", 8);
  assert.ok(timings.equals(new Timings("osuod", 8)));
  assert.ok(!timings.equals(new Timings("osuod", 8.1)));
  assert.equal(timings.toString(), "Timings(osuod, 8)");
  assert.deepEqual(timings.toJSON(), { name: "osuod", data: 8 });
});

test("preserves native subtiming encodings and unknown values", () => {
  assert.equal(new Subtimings("scorev", 1).encode(), 1101);
  assert.equal(new Subtimings("scorev", 2).encode(), 1102);
  assert.deepEqual(Subtimings.decode(1101).toJSON(), { name: "scorev", data: 1 });
  assert.deepEqual(Subtimings.decode(42).toJSON(), { name: "unknown", data: 42 });
  assert.equal(Subtimings.decode(42).encode(), 42);
  assert.equal(new Subtimings("scorev", 2).toString(), "Subtimings(scorev, 2)");
  assert.throws(() => new Subtimings("scorev", 3), /Invalid subtimings/);
  assert.throws(() => Subtimings.decode(1.5), /integer/);
});

test("resolves legal osu mania score versions and defaults omission to ScoreV1", () => {
  const timings = new Timings("osuod", 7.5);
  const implicit_v1 = resolveTimingValues(timings, null);
  const explicit_v1 = resolveTimingValues(timings, new Subtimings("scorev", 1));
  const v2 = resolveTimingValues(timings, new Subtimings("scorev", 2));
  assert.equal(implicit_v1.score_system, "osu_mania_v1");
  assert.deepEqual(implicit_v1.values, explicit_v1.values);
  assert.equal(v2.score_system, "osu_mania_v2");
  assert.deepEqual(v2.values.ShortNote, { hit: [-0.129, 0.105], miss: [-0.166, 0.105] });
  assert.deepEqual(v2.values.LongNoteEnd, { hit: [-0.193, 0.157], miss: [-0.249, 0.157] });
});

test("rejects invalid timing and subtiming pairs", () => {
  assert.throws(() => resolveTimingValues(new Timings("sphere"), new Subtimings("scorev", 1)), /invalid timings-subtimings pair/);
  assert.throws(() => resolveTimingValues(new Timings("osuod", 5), new Subtimings("unknown", 99)), /invalid timings-subtimings pair/);
  assert.throws(() => resolveTimingValues(new Timings("arbitrary"), null), /undefined for arbitrary timings/);
});

test("resolves osu standard OD independently from mania osuod", () => {
  const timings = new Timings("osu_std_od", 7.5);
  const resolved = resolveOsuStandardTimingValues(timings);
  assert.equal(resolved.score_system, "osu_standard_v1");
  assert.deepEqual(resolved.values, {
    hit_300: 0.035, hit_100: 0.08, hit_50: 0.125, early_miss: 0.4, late_miss: 0.125,
  });
  assert.throws(() => resolveTimingValues(timings, null), /osu standard timing resolver/);
  assert.throws(() => resolveOsuStandardTimingValues(new Timings("osuod", 7.5)), /invalid timings-subtimings pair/);
  assert.throws(() => resolveOsuStandardTimingValues(timings, new Subtimings("scorev", 1)), /invalid timings-subtimings pair/);
});

test("truncates osu standard windows to stable integer milliseconds", () => {
  assert.deepEqual(createOsuStandardTimingValues(7.3), {
    hit_300: 0.036, hit_100: 0.081, hit_50: 0.127, early_miss: 0.4, late_miss: 0.127,
  });
});

test("keeps stable asymmetric logic eligibility separate from score windows", () => {
  const values = createOsuStandardTimingValues(5);
  assert.equal(values.early_miss, 0.4);
  assert.equal(values.late_miss, values.hit_50);
});
