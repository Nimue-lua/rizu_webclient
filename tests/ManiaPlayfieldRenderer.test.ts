import assert from "node:assert/strict";
import test from "node:test";
import { ManiaPlayfieldRenderer } from "../src/gameplay/renderer/ManiaPlayfieldRenderer";
import type { NoteSkin } from "../src/gameplay/renderer/NoteSkin";
import { NoteState } from "../src/gameplay/RhythmEngine";

function renderer(with_frame = false, column_spacing: readonly number[] = [0, 0, 0], upside_down = false) {
  return new ManiaPlayfieldRenderer({
    config: {
      mode: "mania",
      columnCount: 4,
      columnStart: 281,
      columnWidths: [73, 73, 73, 73],
      columnSpacing: column_spacing,
      hitPosition: 445,
      comboPosition: 100,
      judgePosition: 125,
      upsideDown: upside_down,
      shortNotes: ["n", "n", "n", "n"],
      shortNoteFlipY: [upside_down, upside_down, upside_down, upside_down],
      longNoteHeads: ["n", "n", "n", "n"],
      longNoteHeadFlipY: [upside_down, upside_down, upside_down, upside_down],
      longNoteBodies: ["n", "n", "n", "n"],
      longNoteBodyFlipY: [upside_down, upside_down, upside_down, upside_down],
      longNoteTails: ["n", "n", "n", "n"],
      longNoteTailFlipY: [!upside_down, !upside_down, !upside_down, !upside_down],
      receptorReleased: ["k", "k", "k", "k"],
      receptorPressed: ["k", "k", "k", "k"],
      receptorFlipY: [upside_down, upside_down, upside_down, upside_down],
      judgments: {}, scoreGlyphs: {}, comboGlyphs: {}, scoreOverlap: 0, comboOverlap: 0,
    },
    sprites: with_frame ? {
      k: {
        image: {} as ImageBitmap,
        sourceSize: { w: 156.5, h: 384 },
        pixelSize: { w: 313, h: 768 },
      },
      n: {
        image: {} as ImageBitmap,
        sourceSize: { w: 100, h: 20 },
        pixelSize: { w: 100, h: 20 },
      },
    } : {},
  } satisfies NoteSkin);
}

function stageRenderer(upside_down = false) {
  const skin = {
    config: {
      mode: "mania" as const,
      columnCount: 2,
      columnStart: 100,
      columnWidths: [50, 50],
      columnSpacing: [4],
      hitPosition: 400,
      comboPosition: 100,
      judgePosition: 125,
      upsideDown: upside_down,
      shortNotes: ["n", "n"], shortNoteFlipY: [false, false],
      longNoteHeads: ["n", "n"], longNoteHeadFlipY: [false, false],
      longNoteBodies: ["n", "n"], longNoteBodyFlipY: [false, false],
      longNoteTails: ["n", "n"], longNoteTailFlipY: [true, true],
      receptorReleased: ["k", "k"], receptorPressed: ["k", "k"], receptorFlipY: [false, false],
      stageHint: "hint", stageLeft: "left", stageRight: "right", stageBottom: "bottom",
      judgments: { perfect: ["judge"] },
      scoreGlyphs: Object.fromEntries([..."0123456789"].map((digit) => [digit, "digit"])),
      comboGlyphs: Object.fromEntries([..."0123456789"].map((digit) => [digit, "digit"])),
      scoreOverlap: 0,
      comboOverlap: 0,
    },
    sprites: Object.fromEntries([
      ["hint", 200, 20], ["left", 16, 768], ["right", 16, 768], ["bottom", 120, 30],
      ["judge", 100, 40], ["digit", 20, 30],
    ].map(([name, width, height]) => [name, {
      image: {} as ImageBitmap,
      sourceSize: { w: width, h: height },
      pixelSize: { w: width, h: height },
    }])),
  } satisfies NoteSkin;
  return new ManiaPlayfieldRenderer(skin);
}

test("uses osu's left-aligned ColumnStart when it fits", () => {
  const layout = renderer().getLayout(854);
  assert.equal(layout.columnLeft[0], 281);
  assert.equal(layout.columnLeft[3], 500);
  assert.equal(layout.receptorY, 445);
});

test("scales and clamps the playfield to narrow viewports", () => {
  const layout = renderer().getLayout(270);
  assert.equal(layout.columnLeft[0], 0);
  assert.equal(layout.columnLeft[3], 202.5);
  assert.equal(layout.columnWidth[0], 67.5);
});

test("positions columns using inter-column spacing", () => {
  const layout = renderer(false, [2, 2, 2]).getLayout(854);
  assert.deepEqual(layout.columnLeft, [281, 356, 431, 506]);
});

test("uses DPI-normalized receptor height and anchors it to the bottom", () => {
  const playfield = renderer(true);
  const layout = playfield.getLayout(854);
  const quads: Parameters<Parameters<typeof playfield.draw>[4]>[] = [];
  playfield.draw(layout, [], 1, [], (...quad) => quads.push(quad));
  assert.deepEqual(quads[0]?.slice(0, 4), [281, 240, 73, 240]);
});

test("moves the LN body edge up by half the head height without moving its tail edge", () => {
  const playfield = renderer(true);
  const layout = playfield.getLayout(854);
  const quads: Parameters<Parameters<typeof playfield.draw>[4]>[] = [];
  playfield.draw(layout, [{
    index: 0,
    column: 1,
    state: NoteState.Clear,
    type: "long",
    start_dt: 0,
    end_dt: 1,
  }], 1, [], (...quad) => quads.push(quad));

  const body = quads[4]!;
  assert.equal(body[1], -35);
  assert.equal(body[3], 472.7);
  const tail = quads[5]!;
  assert.equal(tail[6], true);
});

test("reflects the hit position and note direction for UpsideDown", () => {
  const playfield = renderer(true, [0, 0, 0], true);
  const layout = playfield.getLayout(854);
  assert.equal(layout.receptorY, 35);
  const quads: Parameters<Parameters<typeof playfield.draw>[4]>[] = [];
  playfield.draw(layout, [{
    index: 0,
    column: 1,
    state: NoteState.Clear,
    type: "short",
    start_dt: 0.5,
  }], 1, [], (...quad) => quads.push(quad));
  assert.equal(quads[0]?.[1], 0);
  assert.equal(quads[0]?.[6], true);
  assert.equal(quads[4]?.[1], 275);
  assert.equal(quads[4]?.[6], true);
  assert.deepEqual(playfield.getTimeRange(layout, 1), {
    future: 518 / 480,
    past: 108 / 480,
  });
});

test("positions osu stage sprites using their documented origins", () => {
  const playfield = stageRenderer();
  const quads: Parameters<Parameters<typeof playfield.draw>[4]>[] = [];
  playfield.draw(playfield.getLayout(854), [], 1, [], (...quad) => quads.push(quad));
  assert.deepEqual(quads.map((quad) => quad.slice(0, 4)), [
    [90, 0, 10, 480],
    [204, 0, 10, 480],
    [100, 391, 104, 18],
    [92, 450, 120, 30],
  ]);
});

test("anchors StageBottom and the flipped hint to the top in UpsideDown", () => {
  const playfield = stageRenderer(true);
  const quads: Parameters<Parameters<typeof playfield.draw>[4]>[] = [];
  playfield.draw(playfield.getLayout(854), [], 1, [], (...quad) => quads.push(quad));
  assert.deepEqual(quads[2]?.slice(0, 4), [100, 71, 104, 18]);
  assert.equal(quads[2]?.[6], true);
  assert.deepEqual(quads[3]?.slice(0, 4), [92, 0, 120, 30]);
});

test("centers judgments and combo while right-aligning score and accuracy", () => {
  const playfield = stageRenderer();
  const quads: Parameters<Parameters<typeof playfield.draw>[4]>[] = [];
  playfield.draw(playfield.getLayout(854), [], 1, [], (...quad) => quads.push(quad), {
    combo: 12,
    accuracy: 98.5,
    judgment: "perfect",
    judgmentAge: 0,
  });
  assert.deepEqual(quads[4]?.slice(0, 4), [120.75, 112.5, 62.5, 25]);
  assert.deepEqual(quads[5]?.slice(0, 4), [139.5, 100, 12.5, 18.75]);
  assert.equal(quads[7]?.[0], 764);
  assert.equal(quads.at(-1)?.[0], 840.8000000000001);
});
