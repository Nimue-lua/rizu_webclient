import assert from "node:assert/strict";
import test from "node:test";
import { danAccuracy } from "../src/dan/DanCourse";

test("dan accuracy combines judgment counts instead of averaging chart accuracy", () => {
  const accuracy = danAccuracy([
    { accuracy: 1, judges: { perfect: 1, miss: 0 } },
    { accuracy: 0, judges: { perfect: 0, miss: 3 } },
  ]);
  assert.equal(accuracy, .25);
});

test("dan accuracy supports the full mania judgment table", () => {
  const accuracy = danAccuracy([{ judges: {
    perfect: 1, great: 1, good: 1, ok: 1, meh: 1, miss: 1,
  } }]);
  assert.equal(accuracy, (305 + 300 + 200 + 100 + 50) / (305 * 6));
});

test("dan accuracy is zero before any judgments", () => {
  assert.equal(danAccuracy([]), 0);
});

test("dan accuracy combines osu standard judgments", () => {
  assert.equal(danAccuracy([{ judges: { "300": 2, "100": 1, "50": 1, miss: 0 } }], "osu"), 750 / 1200);
});
