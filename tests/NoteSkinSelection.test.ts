import assert from "node:assert/strict";
import test from "node:test";
import {
  noteSkinMode,
  noteSkinSelectionKey,
  selectedNoteSkin,
} from "../src/gameplay/renderer/NoteSkinSelection";

test("keys skin selections by mode and column count", () => {
  assert.equal(noteSkinSelectionKey("mania", 4), "mania.4");
  assert.equal(noteSkinSelectionKey("osu", null), "osu");
});

test("maps chart modes to skin modes", () => {
  assert.equal(noteSkinMode(0), "osu");
  assert.equal(noteSkinMode(3), "mania");
  assert.equal(noteSkinMode(4), null);
});

test("selects fixed and any-key skins compatible with the requested key mode", () => {
  const selections = { "mania.4": "osu-default", "mania.7": "osu-default" };
  assert.equal(selectedNoteSkin("mania", 4, selections)?.id, "osu-default");
  assert.equal(selectedNoteSkin("mania", 7, selections)?.id, "osu-default");
  assert.equal(selectedNoteSkin("mania", 4, { "mania.4": "" }), undefined);
  assert.equal(selectedNoteSkin("mania", 4, {}), undefined);
});

test("provides the selected osu skin archive", () => {
  assert.equal(selectedNoteSkin("mania", 4, { "mania.4": "osu-default" })?.url, "/skins/osu-default.osk");
});
