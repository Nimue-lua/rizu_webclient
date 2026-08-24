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
  const selections = { "mania.4": "skin1", "mania.7": "skin1" };
  assert.equal(selectedNoteSkin("mania", 4, selections)?.id, "skin1");
  assert.equal(selectedNoteSkin("mania", 7, selections)?.id, "skin1");
  assert.equal(selectedNoteSkin("mania", 4, { "mania.4": "" }), undefined);
  assert.equal(selectedNoteSkin("mania", 4, {}), undefined);
});

test("provides the selected osu skin archive", () => {
  assert.equal(selectedNoteSkin("mania", 4, { "mania.4": "skin1" })?.url, "/skins/skin1.osk");
  assert.equal(selectedNoteSkin("mania", 4, { "mania.4": "osu-default" })?.url, "/skins/osu-default.osk");
});
