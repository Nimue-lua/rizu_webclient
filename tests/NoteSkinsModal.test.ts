import assert from "node:assert/strict";
import test from "node:test";
import { compatibleNoteSkins } from "../src/noteskin/NoteSkinSelection";

test("lists only skins compatible with the selected chart", () => {
  const skins = compatibleNoteSkins("mania", 4);
  assert.ok(skins.length > 0);
  assert.ok(skins.every((skin) => skin.mode === "mania" &&
    (skin.columnCount === null || skin.columnCount === 4)));
});

test("does not list mania skins without a mania column count", () => {
  assert.deepEqual(compatibleNoteSkins("mania", null), []);
  assert.deepEqual(compatibleNoteSkins(null, null), []);
});

test("lists skins for non-mania modes without a column count", () => {
  const skins = compatibleNoteSkins("osu", null);
  assert.ok(skins.some((skin) => skin.id === "osu-default"));
  assert.ok(skins.every((skin) => skin.mode === "osu"));
});

test("filters a dynamic skin registry by mode and mania column count", () => {
  const options = [
    { id: "local", name: "Local", mode: "osu", columnCount: null, url: "blob:local" },
    { id: "local", name: "Local", mode: "mania", columnCount: 7, url: "blob:local" },
  ];
  assert.deepEqual(compatibleNoteSkins("mania", 4, options), []);
  assert.deepEqual(compatibleNoteSkins("mania", 7, options).map((skin) => skin.id), ["local"]);
});
