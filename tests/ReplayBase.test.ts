import assert from "node:assert/strict";
import test from "node:test";
import { ManiaReplayBase } from "../src/replay/mania/ManiaReplayBase";
import { createOsuReplayBase } from "../src/replay/osu/OsuReplayBase";
import { Subtimings } from "../src/gameplay/timing/Subtimings";
import { Timings } from "../src/gameplay/timing/Timings";

test("exports native-compatible strict mania timing identities", () => {
  const replay = new ManiaReplayBase();
  replay.setTimingIdentity(new Timings("osuod", 6.5), new Subtimings("scorev", 2));
  const values = replay.exportReplayBase();
  assert.deepEqual(values.timings, { name: "osuod", data: 6.5 });
  assert.deepEqual(values.subtimings, { name: "scorev", data: 2 });
  assert.deepEqual(values.timing_values.ShortNote, { hit: [-0.132, 0.108], miss: [-0.169, 0.108] });
});

test("imports through an explicit identity and concrete-value validation boundary", () => {
  const source = new ManiaReplayBase();
  source.setTimingIdentity(new Timings("osuod", 5), new Subtimings("scorev", 2));
  const values = source.exportReplayBase();
  values.timing_values.ShortNote.hit[0] = -9;
  assert.throws(() => new ManiaReplayBase().importReplayBase(values), /do not match/);
});

test("replay import and export do not alias mutable values", () => {
  const source = new ManiaReplayBase();
  source.modifiers.push({ id: 1, version: 2, value: "test" });
  source.columns_order = [4, 3, 2, 1];
  const exported = source.exportReplayBase();
  exported.modifiers[0]!.id = 9;
  exported.columns_order![0] = 1;
  assert.equal(source.modifiers[0]!.id, 1);
  assert.equal(source.columns_order[0], 4);

  const imported = new ManiaReplayBase();
  imported.importReplayBase(source.exportReplayBase());
  source.modifiers[0]!.id = 3;
  source.columns_order[0] = 2;
  assert.equal(imported.modifiers[0]!.id, 1);
  assert.equal(imported.columns_order![0], 4);
});

test("osu replay values contain only osu rules and coordinate modifiers", () => {
  const replay = createOsuReplayBase(1.5);
  assert.deepEqual(replay, {
    modifiers: [], rate: 1.5, mode: "osu", custom: false, rate_type: "linear",
    timings: { name: "osu_std_od", data: 5 },
    timing_values: {
      hit_300: 0.05, hit_100: 0.1, hit_50: 0.15, early_miss: 0.4, late_miss: 0.15,
    },
    x_flip: false, y_flip: false, approach_rate: null, circle_size: null, overall_difficulty: null,
  });
  assert.ok(!("nearest" in replay));
  assert.ok(!("tap_only" in replay));
  assert.ok(!("columns_order" in replay));
  assert.ok(!("const" in replay));
  assert.ok(!("subtimings" in replay));
  assert.ok(!("hidden" in replay));
  assert.ok(!("flashlight" in replay));
});
