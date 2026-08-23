import assert from "node:assert/strict";
import test from "node:test";
import {
  noteSkinSelectionKey,
  selectedNoteSkin,
} from "../src/gameplay/renderer/NoteSkinSelection";

test("keys skin selections by mode and column count", () => {
  assert.equal(noteSkinSelectionKey("mania", 4), "mania.4");
});

test("selects only skins compatible with the requested key mode", () => {
  const selections = { "mania.4": "circles", "mania.7": "circles" };
  assert.equal(selectedNoteSkin("mania", 4, selections)?.id, "circles");
  assert.equal(selectedNoteSkin("mania", 7, selections), undefined);
  assert.equal(selectedNoteSkin("mania", 4, { "mania.4": "" }), undefined);
});

test("provides every bundled compatible skin", () => {
  assert.equal(selectedNoteSkin("mania", 4, { "mania.4": "diamonds" })?.url, "/skins/diamonds.zip");
});
