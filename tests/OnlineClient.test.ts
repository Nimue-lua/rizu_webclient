import assert from "node:assert/strict";
import test from "node:test";
import type { ConfigStorage } from "../src/config/Config";
import { OnlineClient } from "../src/online/OnlineClient";

test("uses same-origin URLs when no online server is configured", () => {
  const client = new OnlineClient({ serverAddress: () => "" });
  assert.equal(client.resolveUrl("/api/me"), "/api/me");
});

test("resolves API paths against a configured host or URL", () => {
  const host_client = new OnlineClient({ serverAddress: () => "192.168.1.20:8765/" });
  const url_client = new OnlineClient({ serverAddress: () => "https://rizu.example/game" });

  assert.equal(host_client.resolveUrl("/api/me"), "http://192.168.1.20:8765/api/me");
  assert.equal(url_client.resolveUrl("/api/me"), "https://rizu.example/game/api/me");
});

test("keeps authentication tokens separate for each server", () => {
  const values = new Map<string, string>();
  const storage: ConfigStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
  let address = "one.example";
  const client = new OnlineClient({ serverAddress: () => address, storage });

  client.setToken("first-token");
  address = "two.example";
  assert.deepEqual(client.authorizationHeaders(), {});
  client.setToken("second-token");
  assert.deepEqual(client.authorizationHeaders(), { Authorization: "Bearer second-token" });
  address = "one.example";
  assert.deepEqual(client.authorizationHeaders(), { Authorization: "Bearer first-token" });
});
