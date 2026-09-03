import assert from "node:assert/strict";
import test from "node:test";
import type { ConfigStorage } from "../src/config/Config";
import { createSettingsConfig, settings } from "../src/config/Settings";

test("persists hit error meter visibility, type, and scale", () => {
  let stored: string | null = null;
  const storage: ConfigStorage = {
    getItem: () => stored,
    setItem: (_key, value) => { stored = value; },
    removeItem: () => { stored = null; },
  };
  const config = createSettingsConfig(storage);
  assert.equal(config.get(settings.hit_error_meter), true);
  assert.equal(config.get(settings.hit_error_meter_type), "normal");
  assert.equal(config.get(settings.hit_error_meter_scale), 1);
  config.set(settings.hit_error_meter, false);
  config.set(settings.hit_error_meter_type, "fullscreen");
  config.set(settings.hit_error_meter_scale, 2);
  assert.deepEqual(JSON.parse(stored!), {
    version: 1,
    values: {
      "renderer.hit_error_meter.enabled": false,
      "renderer.hit_error_meter.type": "fullscreen",
      "renderer.hit_error_meter.scale": 2,
    },
  });
});

test("limits hit error meter scale to 0.5x through 2x", () => {
  const config = createSettingsConfig();
  config.set(settings.hit_error_meter_scale, 0.5);
  config.set(settings.hit_error_meter_scale, 2);
  assert.throws(() => config.set(settings.hit_error_meter_scale, 0.49), /Invalid value/);
  assert.throws(() => config.set(settings.hit_error_meter_scale, 2.01), /Invalid value/);
});

test("persists the online server address", () => {
  let stored: string | null = null;
  const config = createSettingsConfig({
    getItem: () => stored,
    setItem: (_key, value) => { stored = value; },
    removeItem: () => { stored = null; },
  });

  assert.equal(config.get(settings.online_server_address), "");
  config.set(settings.online_server_address, "192.168.1.20:8765");
  assert.equal(JSON.parse(stored!).values["online.server_address"], "192.168.1.20:8765");
});
