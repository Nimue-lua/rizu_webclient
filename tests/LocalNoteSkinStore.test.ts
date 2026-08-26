import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  inspectLocalNoteSkin,
  localNoteSkinOptions,
  shouldPersistLocalNoteSkin,
} from "../src/gameplay/renderer/LocalNoteSkinStore";

function archiveFile(name: string, files: Readonly<Record<string, Uint8Array>>) {
  const archive = zipSync(files);
  return {
    name,
    size: archive.byteLength,
    arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer,
  };
}

test("inspects osu and declared mania modes in a local skin", async () => {
  const file = archiveFile("fallback.osk", {
    "skin/skin.ini": strToU8("[General]\nName: Local Test\n[Mania]\nKeys: 7\n[Mania]\nKeys: 4\n[Mania]\nKeys: 7"),
    "skin/hitcircle@2x.png": new Uint8Array([1]),
  });
  const skin = await inspectLocalNoteSkin(file);

  assert.equal(skin.name, "Local Test");
  assert.equal(skin.supportsOsu, true);
  assert.deepEqual(skin.maniaColumnCounts, [4, 7]);
  assert.match(skin.id, /^local:[0-9a-f]{64}$/);
  assert.deepEqual(localNoteSkinOptions(skin, "blob:test").map((option) => [option.mode, option.columnCount]),
    [["osu", null], ["mania", 4], ["mania", 7]]);
});

test("rejects invalid and unsupported local skin archives", async () => {
  await assert.rejects(inspectLocalNoteSkin({
    name: "not-a-skin.osk",
    size: 3,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  }), /not a valid/);
  await assert.rejects(inspectLocalNoteSkin(archiveFile("empty.osk", {
    "skin.ini": strToU8("[General]\nName: Empty"),
  })), /no supported osu or mania/);
});

test("recognizes spinner-only standard skins", async () => {
  const skin = await inspectLocalNoteSkin(archiveFile("spinner.osk", {
    "skin.ini": strToU8("[General]\nName: Spinner"),
    "spinner-circle@2x.png": new Uint8Array([1]),
  }));
  assert.equal(skin.supportsOsu, true);
});

test("keeps archives over 100 MB session-only", () => {
  assert.equal(shouldPersistLocalNoteSkin(100 * 1024 * 1024), true);
  assert.equal(shouldPersistLocalNoteSkin(200 * 1024 * 1024), false);
});
