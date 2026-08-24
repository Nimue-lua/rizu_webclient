import assert from "node:assert/strict";
import test from "node:test";
import {
  noteSkinSelectionKey,
  selectedNoteSkin,
} from "../src/gameplay/renderer/NoteSkinSelection";

test("keys skin selections by mode and column count", () => {
  assert.equal(noteSkinSelectionKey("mania", 4), "mania.4");
});

test("selects fixed and any-key skins compatible with the requested key mode", () => {
  const selections = { "mania.4": "DefaultCircles", "mania.7": "DefaultCircles" };
  assert.equal(selectedNoteSkin("mania", 4, selections)?.id, "DefaultCircles");
  assert.equal(selectedNoteSkin("mania", 7, selections)?.id, "DefaultCircles");
  assert.equal(selectedNoteSkin("mania", 4, { "mania.4": "" }).id, "DefaultCircles");
  assert.equal(selectedNoteSkin("mania", 4, {}).id, "DefaultCircles");
});

test("provides the renamed default skin", () => {
  assert.equal(selectedNoteSkin("mania", 4, { "mania.4": "DefaultCircles" })?.url, "/skins/DefaultCircles.zip");
});
