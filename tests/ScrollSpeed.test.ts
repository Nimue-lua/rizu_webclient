import assert from "node:assert/strict";
import test from "node:test";
import {
  OSU_SCROLL_SPEED_FACTOR,
  scrollSpeedToCanonical,
  scrollSpeedToDisplay,
} from "../src/gameplay/ScrollSpeed";

test("converts osu scroll speed to the canonical engine multiplier", () => {
  assert.equal(scrollSpeedToCanonical("osu", 24), 24 * OSU_SCROLL_SPEED_FACTOR);
  assert.equal(scrollSpeedToDisplay("osu", 24 * OSU_SCROLL_SPEED_FACTOR), 24);
});

test("clamps osu scroll speed to its display range", () => {
  assert.equal(scrollSpeedToCanonical("osu", 0), OSU_SCROLL_SPEED_FACTOR);
  assert.equal(scrollSpeedToCanonical("osu", 41), 40 * OSU_SCROLL_SPEED_FACTOR);
  assert.equal(scrollSpeedToDisplay("osu", 0), 1);
  assert.equal(scrollSpeedToDisplay("osu", 3), 40);
});

test("keeps Rizu scroll speed in canonical units", () => {
  assert.equal(scrollSpeedToCanonical("default", 1.25), 1.25);
  assert.equal(scrollSpeedToDisplay("default", 1.25), 1.25);
});
