import assert from "node:assert/strict";
import test from "node:test";
import { getColumnColorNames } from "../src/gameplay/mania/ColumnColors";

test("uses predefined patterns for common key modes", () => {
  assert.deepEqual(getColumnColorNames(1), ["yellow"]);
  assert.deepEqual(getColumnColorNames(4), ["white", "pink", "pink", "white"]);
  assert.deepEqual(getColumnColorNames(5), ["white", "pink", "yellow", "pink", "white"]);
  assert.deepEqual(getColumnColorNames(7), ["white", "pink", "white", "yellow", "white", "pink", "white"]);
});

test("repeats compatible structures for larger key modes", () => {
  assert.deepEqual(getColumnColorNames(10), [
    "white", "pink", "yellow", "pink", "white",
    "white", "pink", "yellow", "pink", "white",
  ]);
  assert.deepEqual(getColumnColorNames(12), [
    "white", "pink", "white", "white", "pink", "white",
    "white", "pink", "white", "white", "pink", "white",
  ]);
});

test("uses alternating colors when a structure cannot fill the key mode", () => {
  assert.deepEqual(getColumnColorNames(8), ["white", "pink", "pink", "white", "white", "pink", "pink", "white"]);
  assert.deepEqual(getColumnColorNames(11), [
    "pink", "white", "pink", "white", "pink", "yellow", "pink", "white", "pink", "white", "pink",
  ]);
});
