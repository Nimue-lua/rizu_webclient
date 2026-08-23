import assert from "node:assert/strict";
import test from "node:test";
import { parseNoteSkinConfig } from "../src/gameplay/renderer/NoteSkin";

test("parses a note skin config with optional layout and sprite fields", () => {
  assert.deepEqual(parseNoteSkinConfig({
    mode: "mania",
    columnCount: 2,
    columnSize: [48, 64],
    align: 0.25,
    hitPosition: 400,
    comboPosition: 300,
    judgePosition: 250,
    shortNotes: ["left", "right"],
    receptorReleased: ["idle-left", "idle-right"],
    receptorPressed: ["down-left", "down-right"],
  }), {
    mode: "mania",
    columnCount: 2,
    columnSize: [48, 64],
    align: 0.25,
    hitPosition: 400,
    comboPosition: 300,
    judgePosition: 250,
    shortNotes: ["left", "right"],
    longNoteHeads: undefined,
    longNoteBodies: undefined,
    longNoteTails: undefined,
    receptorReleased: ["idle-left", "idle-right"],
    receptorPressed: ["down-left", "down-right"],
  });
});

test("requires mode and columnCount", () => {
  assert.throws(() => parseNoteSkinConfig({ columnCount: 4 }), /mode is required/);
  assert.throws(() => parseNoteSkinConfig({ mode: "mania" }), /columnCount is required/);
});

test("applies layout defaults and leaves missing per-column textures empty", () => {
  assert.deepEqual(parseNoteSkinConfig({
    mode: "mania",
    columnCount: 4,
    columnSize: [64],
    shortNotes: ["note"],
  }), {
    mode: "mania",
    columnCount: 4,
    columnSize: [64, 60, 60, 60],
    align: 0.5,
    hitPosition: 380,
    comboPosition: 200,
    judgePosition: 250,
    shortNotes: ["note", undefined, undefined, undefined],
    longNoteHeads: undefined,
    longNoteBodies: undefined,
    longNoteTails: undefined,
    receptorReleased: undefined,
    receptorPressed: undefined,
  });
});

test("validates supplied layout and sprite values", () => {
  assert.throws(() => parseNoteSkinConfig({ mode: "mania", columnCount: 4, columnSize: [-1] }), /columnSize/);
  assert.throws(() => parseNoteSkinConfig({ mode: "mania", columnCount: 4, shortNotes: [42] }), /shortNotes/);
  assert.throws(() => parseNoteSkinConfig({ mode: "mania", columnCount: 4, align: 2 }), /align/);
});
