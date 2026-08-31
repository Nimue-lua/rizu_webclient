import assert from "node:assert/strict";
import test from "node:test";
import { catalogUrl, remoteAssetUrl } from "../src/library/ProviderUrl";

test("normalizes remote provider URLs to catalog.sqlite", () => {
  assert.equal(catalogUrl("charts.example.com"), "https://charts.example.com/catalog.sqlite");
  assert.equal(catalogUrl("https://charts.example.com/library/"), "https://charts.example.com/library/catalog.sqlite");
  assert.equal(catalogUrl("https://charts.example.com/custom.sqlite"), "https://charts.example.com/custom.sqlite");
});

test("resolves encoded assets relative to provider catalogs", () => {
  assert.equal(remoteAssetUrl("https://s3.kuudere.fun/library/catalog.sqlite", "charts/My Song/audio file.ogg"),
    "https://s3.kuudere.fun/library/charts/My%20Song/audio%20file.ogg");
  assert.equal(remoteAssetUrl("https://s3.kuudere.fun/catalog.sqlite", "/charts/song.osu"),
    "https://s3.kuudere.fun/charts/song.osu");
});

test("rejects insecure public providers", () => {
  assert.throws(() => catalogUrl("http://charts.example.com"), /must use HTTPS/);
  assert.equal(catalogUrl("http://localhost:8080"), "http://localhost:8080/catalog.sqlite");
});
