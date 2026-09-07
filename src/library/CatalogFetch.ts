import { downloadArrayBuffer, type DownloadProgressCallback } from "../download/Download";

// The remote catalog is several megabytes (currently ~5.6 MB compressed). Only
// abort an attempt when it stalls; an absolute timeout restarts healthy
// downloads forever on connections that need more than 30 seconds.
export const FETCH_TIMEOUT_MS = 30_000;
export const FETCH_MAX_RETRIES = 2;
export const RETRY_BASE_DELAY_MS = 1_000;

export async function fetchCatalog(url: string, signal?: AbortSignal,
  onProgress?: DownloadProgressCallback): Promise<Uint8Array> {
  const timeout_controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const resetTimeout = (): void => {
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = setTimeout(() => {
      timeout_controller.abort(new DOMException("Catalog download stalled", "TimeoutError"));
    }, FETCH_TIMEOUT_MS);
  };
  resetTimeout();
  const combined_signal = signal ? AbortSignal.any([signal, timeout_controller.signal]) : timeout_controller.signal;
  // "no-cache" (instead of "no-store") lets the browser revalidate with the
  // server ETag/Last-Modified and serve a tiny 304 response when the catalog
  // is unchanged, which avoids re-downloading megabytes on slow connections.
  try {
    return new Uint8Array(await downloadArrayBuffer(url, { cache: "no-cache", signal: combined_signal }, (progress) => {
      resetTimeout();
      onProgress?.(progress);
    }));
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function isRetryableCatalogError(reason: unknown): boolean {
  if (!(reason instanceof Error)) return true;
  if (reason.name === "AbortError" || reason.name === "TimeoutError") return true;
  const message = reason.message;
  // HTTP status failures thrown by downloadArrayBuffer embed the status code.
  // Client errors (except 408/429) are deterministic: retrying won't help.
  const status = message.match(/:\s(\d{3})\b/);
  if (status) {
    const code = Number(status[1]);
    return code === 408 || code === 429 || code >= 500;
  }
  return /abort|timeout|timed out|fetch failed|failed to fetch|network|load failed|econn|socket hang up/i.test(message);
}

function retryDelay(attempt: number, signal?: AbortSignal): Promise<void> {
  const delay_ms = RETRY_BASE_DELAY_MS * 2 ** attempt + Math.random() * 500;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Catalog download was cancelled", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delay_ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Catalog download was cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function describeCatalogError(reason: unknown): string {
  if (reason instanceof Error && (reason.name === "AbortError" || reason.name === "TimeoutError" ||
    /BodyStreamBuffer was aborted/i.test(reason.message))) {
    return `Download timed out after ${FETCH_MAX_RETRIES + 1} attempts with no data for ${FETCH_TIMEOUT_MS / 1000}s. ` +
      "Check your connection and try refreshing the library.";
  }
  return reason instanceof Error ? reason.message : "Provider is unavailable";
}

export async function fetchCatalogWithRetry(url: string, signal?: AbortSignal,
  onProgress?: DownloadProgressCallback): Promise<Uint8Array> {
  let last_error: unknown = null;
  for (let attempt = 0; attempt <= FETCH_MAX_RETRIES; attempt += 1) {
    if (signal?.aborted) throw new DOMException("Catalog download was cancelled", "AbortError");
    try {
      return await fetchCatalog(url, signal, onProgress);
    } catch (reason) {
      last_error = reason;
      if (signal?.aborted || attempt === FETCH_MAX_RETRIES || !isRetryableCatalogError(reason)) throw reason;
      await retryDelay(attempt, signal);
    }
  }
  throw last_error instanceof Error ? last_error : new Error("Provider is unavailable");
}
