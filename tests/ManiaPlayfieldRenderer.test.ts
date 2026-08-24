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
    },
    frames: with_frame ? {
      k: {
        frame: { x: 0, y: 0, w: 313, h: 768 },
        spriteSourceSize: { x: 0, y: 0, w: 156.5, h: 384 },
        sourceSize: { w: 156.5, h: 384 },
        pixelSize: { w: 313, h: 768 },
      },
      n: {
        frame: { x: 0, y: 768, w: 100, h: 20 },
        spriteSourceSize: { x: 0, y: 0, w: 100, h: 20 },
        sourceSize: { w: 100, h: 20 },
        pixelSize: { w: 100, h: 20 },
      },
    } : {},
    image: {} as ImageBitmap,
  } satisfies NoteSkin);
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
