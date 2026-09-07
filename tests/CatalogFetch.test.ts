import assert from "node:assert/strict";
import test from "node:test";
import { describeCatalogError, FETCH_MAX_RETRIES, fetchCatalogWithRetry, isRetryableCatalogError } from "../src/library/CatalogFetch";

const CATALOG_URL = "https://s3.kuudere.fun/catalog.sqlite";

function stubFetch(implementation: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  return () => { globalThis.fetch = original; };
}

function okResponse(bytes: Uint8Array): Response {
  return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } });
}

function abortError(): DOMException {
  // Chromium surfaces a mid-body abort of fetch() with this message.
  return new DOMException("BodyStreamBuffer was aborted", "AbortError");
}

test("retries a mid-download abort and then succeeds", async (t) => {
  const expected = new Uint8Array([1, 2, 3, 4]);
  let calls = 0;
  t.after(stubFetch(async () => {
    calls += 1;
    if (calls === 1) throw abortError();
    return okResponse(expected);
  }));
  const actual = await fetchCatalogWithRetry(CATALOG_URL);
  assert.deepEqual(actual, expected);
  assert.equal(calls, 2);
});

test("retries server errors but not deterministic client errors", async (t) => {
  let server_calls = 0;
  t.after(stubFetch(async () => {
    server_calls += 1;
    if (server_calls === 1) return new Response("boom", { status: 500 });
    return okResponse(new Uint8Array([9]));
  }));
  const actual = await fetchCatalogWithRetry(CATALOG_URL);
  assert.deepEqual(actual, new Uint8Array([9]));
  assert.equal(server_calls, 2);

  assert.equal(isRetryableCatalogError(new Error("Failed to fetch https://x/catalog.sqlite: 404 Not Found")), false);
  assert.equal(isRetryableCatalogError(new Error("Failed to fetch https://x/catalog.sqlite: 500 Error")), true);
  assert.equal(isRetryableCatalogError(abortError()), true);
});

test("does not retry a 404 response", async (t) => {
  let calls = 0;
  t.after(stubFetch(async () => {
    calls += 1;
    return new Response("missing", { status: 404 });
  }));
  await assert.rejects(fetchCatalogWithRetry(CATALOG_URL), /404/);
  assert.equal(calls, 1);
});

test("gives up after exhausting retries", async (t) => {
  let calls = 0;
  t.after(stubFetch(async () => {
    calls += 1;
    throw abortError();
  }));
  await assert.rejects(fetchCatalogWithRetry(CATALOG_URL), (reason: unknown) =>
    reason instanceof DOMException && reason.name === "AbortError" && reason.message === "BodyStreamBuffer was aborted");
  assert.equal(calls, FETCH_MAX_RETRIES + 1);
});

test("respects caller cancellation without retrying", async (t) => {
  let calls = 0;
  t.after(stubFetch(async () => {
    calls += 1;
    return okResponse(new Uint8Array([1]));
  }));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchCatalogWithRetry(CATALOG_URL, controller.signal), /cancelled/);
  assert.equal(calls, 0);
});

test("describes timeouts in user-friendly terms", () => {
  assert.match(describeCatalogError(abortError()), /timed out after 3 attempts/);
  assert.match(describeCatalogError(abortError()), /refreshing the library/);
  assert.equal(describeCatalogError(new Error("Failed to fetch https://x/catalog.sqlite: 404 Not Found")),
    "Failed to fetch https://x/catalog.sqlite: 404 Not Found");
});
