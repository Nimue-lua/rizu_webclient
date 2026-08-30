import assert from "node:assert/strict";
import test from "node:test";
import {
  booleanSetting,
  choiceSetting,
  Config,
  type ConfigStorage,
  numberSetting,
  stringSetting,
} from "../src/config/Config";

class MemoryStorage implements ConfigStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const volume = numberSetting("audio.volume", 0.2, 0, 1, 0.01);
const renderer = choiceSetting("renderer", "direct", ["direct", "stable"]);
const enabled = booleanSetting("enabled", true);
const nickname = stringSetting("nickname", "Anonymous");
const definitions = [volume, renderer, enabled, nickname] as const;

test("stores only non-default overrides in one versioned document", () => {
  const storage = new MemoryStorage();
  const config = new Config("settings", definitions, storage);
  config.set(volume, 0.5);
  config.set(renderer, "stable");
  assert.deepEqual(JSON.parse(storage.getItem("settings")!), {
    version: 1,
    values: { "audio.volume": 0.5, renderer: "stable" },
  });

  config.set(volume, 0.2);
  assert.deepEqual(JSON.parse(storage.getItem("settings")!), {
    version: 1,
    values: { renderer: "stable" },
  });
});

test("validates writes and notifies only effective changes", () => {
  const config = new Config("settings", definitions);
  let notifications = 0;
  const unsubscribe = config.subscribe(volume, () => notifications++);
  config.set(volume, 0.5);
  config.set(volume, 0.5);
  assert.equal(notifications, 1);
  assert.throws(() => config.set(volume, 2), /Invalid value/);
  assert.equal(config.get(volume), 0.5);
  unsubscribe();
  config.set(volume, 0.7);
  assert.equal(notifications, 1);
});

test("loads atomically, ignores retired keys, and rejects corrupt values", () => {
  const storage = new MemoryStorage();
  storage.setItem("settings", JSON.stringify({
    version: 1,
    values: { "audio.volume": 0.8, retired: "ignored" },
  }));
  const config = new Config("settings", definitions, storage);
  assert.equal(config.load(), true);
  assert.equal(config.get(volume), 0.8);

  storage.setItem("settings", JSON.stringify({
    version: 1,
    values: { "audio.volume": 0.1, renderer: "invalid" },
  }));
  assert.equal(config.load(), false);
  assert.equal(config.get(volume), 0.8);
});

test("keeps working when persistence is unavailable", () => {
  const storage: ConfigStorage = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
    removeItem: () => { throw new Error("blocked"); },
  };
  const config = new Config("settings", definitions, storage);
  assert.equal(config.load(), false);
  config.set(enabled, false);
  assert.equal(config.get(enabled), false);
});
