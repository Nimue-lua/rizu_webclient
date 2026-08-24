import assert from "node:assert/strict";
import test from "node:test";
import {
  osuManiaColumnType,
  parseOsuManiaConfig,
  parseSkinIni,
  resolveOsuManiaTail,
} from "../src/gameplay/renderer/OsuSkin";

const source = `\uFEFF[General]\nName: Test skin\n\n[Mania]\nKeys: 4\nColumnStart: 281\nColumnWidth: 73, 74, 75, 76\nColumnSpacing: 1, 2, 3 // comment\nHitPosition: 445\nScorePosition: 125\nComboPosition: 100\nKeyImage0: keys\\one\nKeyImage0D: keys/one-down\nNoteImage0: notes/one\nNoteImage0H: notes/one-head\nNoteImage0L: notes/one-body\nNoteImage0T: notes/one-tail\nKeyImage1: keys/two\nKeyImage1D: keys/two-down\nNoteImage1: notes/two\nNoteImage1H: notes/two-head\nNoteImage1L: notes/two-body\nNoteImage1T: notes/two-tail\nKeyImage2: keys/three\nKeyImage2D: keys/three-down\nNoteImage2: notes/three\nNoteImage2H: notes/three-head\nNoteImage2L: notes/three-body\nNoteImage2T: notes/three-tail\nKeyImage3: keys/four\nKeyImage3D: keys/four-down\nNoteImage3: notes/four\nNoteImage3H: notes/four-head\nNoteImage3L: notes/four-body\nNoteImage3T: notes/four-tail\n\n[Mania]\nKeys: 7\n`;

test("parses repeated Mania sections, BOM, comments, and colon values", () => {
  const ini = parseSkinIni(source.replace("Name: Test skin", "Name: Test: skin"));
  assert.equal(ini.sections.General?.Name, "Test: skin");
  assert.equal(ini.mania.length, 2);
  assert.equal(ini.mania[0]?.ColumnSpacing, "1, 2, 3");
});

test("maps the matching osu mania section to playfield geometry and sprites", () => {
  const config = parseOsuManiaConfig(parseSkinIni(source), 4);
  assert.equal(config.mode, "mania");
  assert.equal(config.columnCount, 4);
  assert.equal(config.columnStart, 281);
  assert.deepEqual(config.columnWidths, [73, 74, 75, 76]);
  assert.deepEqual(config.columnSpacing, [1, 2, 3]);
  assert.equal(config.hitPosition, 445);
  assert.equal(config.judgePosition, 125);
  assert.equal(config.comboPosition, 100);
  assert.deepEqual(config.receptorReleased, ["keys/one", "keys/two", "keys/three", "keys/four"]);
  assert.deepEqual(config.shortNotes, ["notes/one", "notes/two", "notes/three", "notes/four"]);
});

test("uses native osu defaults when sprite mappings are absent", () => {
  const ini = parseSkinIni(source);
  assert.throws(() => parseOsuManiaConfig(ini, 6), /does not contain a 6K/);
  const config = parseOsuManiaConfig(ini, 7);
  assert.deepEqual(config.shortNotes, [
    "mania-note1", "mania-note2", "mania-note1", "mania-noteS", "mania-note1", "mania-note2", "mania-note1",
  ]);
  assert.equal(config.longNoteHeads[0], "mania-note1H");
});

test("matches native osu mania column patterns and special styles", () => {
  assert.deepEqual(Array.from({ length: 4 }, (_, column) => osuManiaColumnType(column, 4, 0)), ["2", "1", "1", "2"]);
  assert.deepEqual(Array.from({ length: 5 }, (_, column) => osuManiaColumnType(column, 5, 0)), ["2", "1", "S", "1", "2"]);
  assert.deepEqual(Array.from({ length: 4 }, (_, column) => osuManiaColumnType(column, 4, 1)), ["S", "1", "2", "1"]);
});

test("reads osu column spacing partially and ignores extra values", () => {
  const config = parseOsuManiaConfig(parseSkinIni(source
    .replace("ColumnSpacing: 1, 2, 3 // comment", "ColumnSpacing: 2,2,2,2")), 4);
  assert.deepEqual(config.columnSpacing, [2, 2, 2]);

  const partial = parseOsuManiaConfig(parseSkinIni(source
    .replace("ColumnSpacing: 1, 2, 3 // comment", "ColumnSpacing: 2,invalid")), 4);
  assert.deepEqual(partial.columnSpacing, [2, 0, 0]);
});

test("uses a custom LN head before the default tail when the configured tail is missing", () => {
  assert.equal(resolveOsuManiaTail(
    "mania-note2T", "Notes\\grayln", "Notes/grayln", "mania-note2T",
    new Set(["notes/grayln"]), new Set(["mania-note2t"]),
  ), "Notes/grayln");
});
