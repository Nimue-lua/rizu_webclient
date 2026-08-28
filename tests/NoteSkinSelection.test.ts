import assert from "node:assert/strict";
import test from "node:test";
import {
  noteSkinMode,
  noteSkinSelectionKey,
  selectedNoteSkin,
} from "../src/noteskin/NoteSkinSelection";

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
  assert.equal(selectedNoteSkin("mania", 4, { "mania.4": "" })?.id, "osu-default");
  assert.equal(selectedNoteSkin("mania", 4, {})?.id, "osu-default");
});

test("provides the selected osu skin archive", () => {
  assert.equal(selectedNoteSkin("mania", 4, { "mania.4": "osu-default" })?.url, "/skins/osu-default.osk");
});

test("falls back to the built-in default when a selection is stale", () => {
  assert.equal(selectedNoteSkin("osu", null, { osu: "deleted-skin" })?.id, "osu-default");
  assert.equal(selectedNoteSkin("mania", 7, { "mania.7": "deleted-skin" })?.id, "osu-default");
});
