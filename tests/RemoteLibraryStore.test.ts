import assert from "node:assert/strict";
import test from "node:test";
import { catalogUrl, DEFAULT_REMOTE_PROVIDER, remoteAssetUrl } from "../src/library/ProviderUrl";

test("uses charts.kuudere.fun as the built-in provider", () => {
  assert.deepEqual(DEFAULT_REMOTE_PROVIDER, {
    id: "builtin",
    name: "charts.kuudere.fun",
    catalog_url: "https://charts.kuudere.fun/catalog.sqlite",
  });
});

test("normalizes remote provider URLs to catalog.sqlite", () => {
  assert.equal(catalogUrl("charts.kuudere.fun"), "https://charts.kuudere.fun/catalog.sqlite");
  assert.equal(catalogUrl("https://charts.kuudere.fun/library/"), "https://charts.kuudere.fun/library/catalog.sqlite");
  assert.equal(catalogUrl("https://charts.kuudere.fun/custom.sqlite"), "https://charts.kuudere.fun/custom.sqlite");
});

test("resolves encoded assets relative to provider catalogs", () => {
  assert.equal(remoteAssetUrl("https://charts.kuudere.fun/library/catalog.sqlite", "charts/My Song/audio file.ogg"),
    "https://charts.kuudere.fun/library/charts/My%20Song/audio%20file.ogg");
  assert.equal(remoteAssetUrl("https://charts.kuudere.fun/catalog.sqlite", "/charts/song.osu"),
    "https://charts.kuudere.fun/charts/song.osu");
});

test("rejects insecure public providers", () => {
  assert.throws(() => catalogUrl("http://charts.kuudere.fun"), /must use HTTPS/);
  assert.equal(catalogUrl("http://localhost:8080"), "http://localhost:8080/catalog.sqlite");
});
