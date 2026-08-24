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
  const selections = { "mania.4": "Ralsei", "mania.7": "Ralsei" };
  assert.equal(selectedNoteSkin("mania", 4, selections)?.id, "Ralsei");
  assert.equal(selectedNoteSkin("mania", 7, selections)?.id, "Ralsei");
  assert.equal(selectedNoteSkin("mania", 4, { "mania.4": "" }), undefined);
  assert.equal(selectedNoteSkin("mania", 4, {}), undefined);
});

test("provides the selected osu skin archive", () => {
  assert.equal(selectedNoteSkin("mania", 4, { "mania.4": "Ralsei" })?.url, "/skins/skin.osk");
});
