import assert from "node:assert/strict";
import test from "node:test";
import {
  loadNoteSkinOverrides,
  noteSkinOverrideKey,
  saveManiaColumnStartOverride,
  saveManiaComboPositionOverride,
  saveManiaHitPositionOverride,
  saveManiaJudgePositionOverride,
} from "../src/noteskin/NoteSkinOverrides";

test("keys overrides by skin, mode, and mania column count", () => {
  assert.equal(noteSkinOverrideKey("local:abc", "mania", 4), "local:abc:mania.4");
  assert.equal(noteSkinOverrideKey("osu-default", "osu", null), "osu-default:osu");
});

test("persists and resets a mania hit position override", () => {
  const values = new Map<string, string>();
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  try {
    const key = noteSkinOverrideKey("skin", "mania", 7);
    saveManiaHitPositionOverride(key, 375);
    saveManiaColumnStartOverride(key, 220);
    saveManiaJudgePositionOverride(key, 250);
    saveManiaComboPositionOverride(key, 150);
    assert.equal(loadNoteSkinOverrides(key).mania?.hitPosition, 375);
    assert.equal(loadNoteSkinOverrides(key).mania?.columnStart, 220);
    assert.equal(loadNoteSkinOverrides(key).mania?.judgePosition, 250);
    assert.equal(loadNoteSkinOverrides(key).mania?.comboPosition, 150);
    saveManiaHitPositionOverride(key, undefined);
    assert.deepEqual(loadNoteSkinOverrides(key), { mania: { columnStart: 220, judgePosition: 250, comboPosition: 150 } });
    saveManiaColumnStartOverride(key, undefined);
    saveManiaJudgePositionOverride(key, undefined);
    saveManiaComboPositionOverride(key, undefined);
    assert.deepEqual(loadNoteSkinOverrides(key), {});
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previous });
  }
});
