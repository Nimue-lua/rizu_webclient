import assert from "node:assert/strict";
import test from "node:test";
import { getGameplayProgress, getGameplayProgressRange } from "../src/gameplay/GameplayTiming";
import type { GameplayData } from "../src/library/GameplayLoader";

test("uses negative progress for the intro and positive progress through gameplay", () => {
  const data = {
    mode: "mania",
    chart: {
      mode: "mania",
      notes: [
        { column: 0, absolute_time: 2, weight: 0 },
        { column: 0, absolute_time: 6, weight: 1 },
        { column: 0, absolute_time: 7, weight: -1 },
      ],
    },
  } as GameplayData;
  const range = getGameplayProgressRange(data, 1);
  assert.deepEqual(range, { introStart: -0.1, firstObject: 2, lastObject: 7 });
  assert.equal(getGameplayProgress(-0.1, range), -1);
  assert.equal(getGameplayProgress(0.95, range), -0.5);
  assert.equal(getGameplayProgress(2, range), 0);
  assert.equal(getGameplayProgress(4.5, range), 0.5);
  assert.equal(getGameplayProgress(7, range), 1);
});
