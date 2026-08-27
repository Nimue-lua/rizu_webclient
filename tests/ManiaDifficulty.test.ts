import assert from "node:assert/strict";
import test from "node:test";
import type { ManiaNoteEvent } from "../src/chart/Chart";
import { calculateManiaDifficulty } from "../src/gameplay/mania/scoring/ManiaDifficulty";

function rating(notes: readonly ManiaNoteEvent[], column_count = 4): number {
  return calculateManiaDifficulty({ column_count, notes });
}

test("uses LN release times as rhythm actions", () => {
  const taps: ManiaNoteEvent[] = [
    { column: 1, absolute_time: 0, weight: 0 },
    { column: 2, absolute_time: 0.4, weight: 0 },
  ];
  const hold: ManiaNoteEvent[] = [
    { column: 1, absolute_time: 0, weight: 1 },
    { column: 1, absolute_time: 0.2, weight: -1 },
    { column: 2, absolute_time: 0.4, weight: 0 },
  ];
  assert.ok(rating(hold) > rating(taps));
});

test("rates chords and notes played while holding LNs higher", () => {
  const singles: ManiaNoteEvent[] = [
    { column: 1, absolute_time: 0, weight: 0 },
    { column: 2, absolute_time: 0.2, weight: 0 },
  ];
  const chord: ManiaNoteEvent[] = [
    { column: 1, absolute_time: 0, weight: 0 },
    { column: 2, absolute_time: 0.2, weight: 0 },
    { column: 3, absolute_time: 0.2, weight: 0 },
  ];
  const hold_pressure: ManiaNoteEvent[] = [
    { column: 1, absolute_time: 0, weight: 1 },
    { column: 2, absolute_time: 0.2, weight: 0 },
    { column: 1, absolute_time: 1, weight: -1 },
  ];
  assert.ok(rating(chord) > rating(singles));
  assert.ok(rating(hold_pressure) > rating(singles));
});

test("continuous mania streams build stamina strain", () => {
  const stream = (count: number): ManiaNoteEvent[] => Array.from({ length: count }, (_, index) => ({
    column: index % 4 + 1,
    absolute_time: index * 0.1,
    weight: 0,
  }));
  assert.ok(rating(stream(601)) > rating(stream(21)) + 0.2);
});

test("dense regular notes rate above equally dense LN actions", () => {
  const regular: ManiaNoteEvent[] = Array.from({ length: 101 }, (_, index) => ({
    column: index % 4 + 1,
    absolute_time: index * 0.1,
    weight: 0,
  }));
  const long_notes: ManiaNoteEvent[] = Array.from({ length: 50 }, (_, index) => [
    { column: index % 4 + 1, absolute_time: index * 0.2, weight: 1 as const },
    { column: index % 4 + 1, absolute_time: index * 0.2 + 0.1, weight: -1 as const },
  ]).flat();
  assert.ok(rating(regular) > rating(long_notes) + 0.5);
});

test("distinguishes extreme stream interval speeds", () => {
  const stream = (interval_ms: number): ManiaNoteEvent[] => Array.from({ length: 401 }, (_, index) => ({
    column: index % 4 + 1,
    absolute_time: index * interval_ms / 1000,
    weight: 0,
  }));
  const delta_like = rating(stream(39));
  const epsilon_like = rating(stream(32));
  const final_like = rating(stream(30));
  assert.ok(final_like > epsilon_like);
  assert.ok(epsilon_like > delta_like);
});
