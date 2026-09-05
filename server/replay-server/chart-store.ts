import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { catalogChart } from "./catalog.ts";

const MAX_CHART_SIZE = 16 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

export class RetryableChartError extends Error {}

export interface ChartStoreOptions {
  cache_directory: string;
  asset_base_url: string;
  request?: typeof fetch;
}

export class ChartStore {
  private readonly pending = new Map<string, Promise<Uint8Array>>();
  private readonly request: typeof fetch;

  constructor(private readonly catalog: DatabaseSync, private readonly options: ChartStoreOptions) {
    this.request = options.request ?? fetch;
  }

  load(chart_md5: string, chart_index: number): Promise<Uint8Array> {
    const key = chart_md5.toLowerCase();
    const active = this.pending.get(key);
    if (active) return active;
    const loading = this.loadUnshared(key, chart_index).finally(() => this.pending.delete(key));
    this.pending.set(key, loading);
    return loading;
  }

  private async loadUnshared(chart_md5: string, chart_index: number): Promise<Uint8Array> {
    if (!/^[a-f\d]{32}$/.test(chart_md5)) throw new Error("Invalid chart hash");
    const chart = catalogChart(this.catalog, chart_md5, chart_index);
    if (!chart) throw new Error("Chart is not in the catalog");
    this.validateAssetPath(chart.chart_path, chart_md5);
    const cache_path = path.join(this.options.cache_directory, `${chart_md5}.osu`);
    try {
      const cached = await readFile(cache_path);
      if (this.matchesHash(cached, chart_md5)) return cached;
      await rm(cache_path, { force: true });
    } catch (reason) {
      if (!reason || typeof reason !== "object" || !("code" in reason) || reason.code !== "ENOENT") throw reason;
    }

    const url = new URL(chart.chart_path.split("/").map(encodeURIComponent).join("/"), this.options.asset_base_url);
    const base = new URL(this.options.asset_base_url);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`)) {
      throw new Error("Chart path escapes the asset base URL");
    }
    let response: Response;
    try {
      response = await this.request(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch (reason) {
      throw new RetryableChartError(`Chart download failed: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
    if (!response.ok) throw new RetryableChartError(`Chart download returned ${response.status}`);
    const declared_size = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared_size) && declared_size > MAX_CHART_SIZE) throw new Error("Chart file is too large");
    if (!response.body) throw new Error("Chart download returned no body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_CHART_SIZE) throw new Error("Chart file is too large");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks, size);
    if (bytes.length === 0 || bytes.length > MAX_CHART_SIZE) throw new Error("Chart file is empty or too large");
    if (!this.matchesHash(bytes, chart_md5)) throw new Error("Downloaded chart hash does not match the catalog");
    await mkdir(this.options.cache_directory, { recursive: true });
    const temporary_path = `${cache_path}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary_path, bytes, { flag: "wx" });
      await rename(temporary_path, cache_path);
    } finally {
      await rm(temporary_path, { force: true });
    }
    return bytes;
  }

  private validateAssetPath(asset_path: string, chart_md5: string): void {
    if (asset_path !== `chart-files/v1/${chart_md5}.osu`) throw new Error("Catalog contains an unsafe chart path");
  }

  private matchesHash(bytes: Uint8Array, expected: string): boolean {
    return createHash("md5").update(bytes).digest("hex") === expected;
  }
}
