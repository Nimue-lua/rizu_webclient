import assert from "node:assert/strict";
import test from "node:test";
import type { GameplayData } from "../src/library/GameplayLoader";
import { getAudioStartDelay } from "../src/gameplay/GameplayRuntime";

function createData(note_times: readonly number[]): GameplayData {
  return {
    audio_buffer: null as unknown as AudioBuffer,
    audio_context: null as unknown as AudioContext,
    chart: {
      column_count: 1,
      primary_tempo: 120,
      notes: note_times.map((absolute_time) => ({ column: 1, absolute_time, weight: 0 })),
      visual_points: [],
    },
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
