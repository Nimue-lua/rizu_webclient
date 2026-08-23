import assert from "node:assert/strict";
import test from "node:test";
import { noteSkinColumnCounts } from "../src/app/NoteSkinsModal";

test("lists key modes through an 88-key piano", () => {
  const counts = noteSkinColumnCounts(null);
  assert.equal(counts[0], 1);
  assert.equal(counts.at(-1), 88);
  assert.equal(counts.length, 88);
});

test("includes a selected chart beyond a piano key range", () => {
  const counts = noteSkinColumnCounts(100);
  assert.equal(counts.at(-1), 100);
  assert.ok(counts.includes(10));
  assert.ok(counts.includes(100));
});
