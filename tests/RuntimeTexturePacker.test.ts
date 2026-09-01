import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeTextureAtlases, packRuntimeTextureLayout } from
  "../src/gameplay/renderer/RuntimeTexturePacker";

function image(width: number, height: number, name: string): ImageBitmap {
  return { width, height, name } as unknown as ImageBitmap;
}

test("packs deterministically with independent extrusion and padding", () => {
  const small = image(2, 3, "small");
  const wide = image(4, 3, "wide");
  const layout = packRuntimeTextureLayout([{ value: "small", image: small }, { value: "wide", image: wide }],
    { maxWidth: 18, maxHeight: 9, extrusion: 1, padding: 2 });

  assert.equal(layout.pages.length, 1);
  assert.equal(layout.pages[0]!.width, 18);
  assert.equal(layout.pages[0]!.height, 9);
  assert.deepEqual(layout.pages[0]!.entries.map(({ value, x, y }) => ({ value, x, y })), [
    { value: "wide", x: 3, y: 3 }, { value: "small", x: 13, y: 3 },
  ]);
});

test("creates additional pages and leaves textures that cannot fit standalone", () => {
  const layout = packRuntimeTextureLayout([
    { value: "first", image: image(6, 6, "first") },
    { value: "second", image: image(6, 6, "second") },
    { value: "large", image: image(9, 2, "large") },
  ], { maxWidth: 8, maxHeight: 8, extrusion: 1 });

  assert.equal(layout.pages.length, 2);
  assert.deepEqual(layout.pages.map((page) => page.entries[0]!.value), ["first", "second"]);
  assert.deepEqual(layout.standalone.map((source) => source.value), ["large"]);
});

test("extrudes the outermost texels and leaves outer padding untouched", () => {
  const source = image(2, 3, "source");
  const layout = packRuntimeTextureLayout([{ value: "source", image: source }],
    { maxWidth: 16, maxHeight: 16, extrusion: 2, padding: 1 });
  const draws: unknown[][] = [];
  const canvas = { getContext: () => ({ drawImage: (...args: unknown[]) => draws.push(args) }) } as unknown as HTMLCanvasElement;

  const atlases = createRuntimeTextureAtlases(layout, () => canvas);

  assert.equal(atlases[0]!.width, 8);
  assert.equal(atlases[0]!.height, 9);
  assert.equal(draws.length, 9);
  assert.deepEqual(draws[0], [source, 3, 3, 2, 3]);
  assert.deepEqual(draws[1], [source, 0, 0, 1, 3, 1, 3, 2, 3]);
  assert.deepEqual(draws[2], [source, 1, 0, 1, 3, 5, 3, 2, 3]);
  assert.deepEqual(draws[8], [source, 1, 2, 1, 1, 5, 6, 2, 2]);
});
