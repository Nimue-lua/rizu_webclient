import assert from "node:assert/strict";
import test from "node:test";
import { ManiaPlayfieldRenderer } from "../src/gameplay/renderer/ManiaPlayfieldRenderer";
import type { NoteSkin } from "../src/gameplay/renderer/NoteSkin";

function renderer(with_frame = false, column_spacing: readonly number[] = [0, 0, 0]) {
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
      shortNotes: ["n", "n", "n", "n"],
      longNoteHeads: ["n", "n", "n", "n"],
      longNoteBodies: ["n", "n", "n", "n"],
      longNoteTails: ["n", "n", "n", "n"],
      receptorReleased: ["k", "k", "k", "k"],
      receptorPressed: ["k", "k", "k", "k"],
    },
    frames: with_frame ? {
      k: {
        frame: { x: 0, y: 0, w: 313, h: 768 },
        spriteSourceSize: { x: 0, y: 0, w: 156.5, h: 384 },
        sourceSize: { w: 156.5, h: 384 },
        pixelSize: { w: 313, h: 768 },
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
