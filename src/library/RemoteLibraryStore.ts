import { loadSqliteCatalog, type Library, type LibraryProgressCallback } from "./Library";
import type { LibraryView } from "./views";
import { catalogUrl, DEFAULT_REMOTE_PROVIDER } from "./ProviderUrl";
import { downloadArrayBuffer, type DownloadProgressCallback } from "../download/Download";

const DATABASE_NAME = "rizu-remote-libraries";
const DATABASE_VERSION = 1;
const PROVIDER_STORE = "providers";
const CATALOG_STORE = "catalogs";
const FETCH_TIMEOUT_MS = 5_000;

export interface RemoteProvider {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly catalog_url: string;
}

export interface RemoteProviderView extends RemoteProvider {
  readonly status: "checking" | "available" | "unavailable";
  readonly error: string | null;
}

type Listener = () => void;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PROVIDER_STORE)) request.result.createObjectStore(PROVIDER_STORE, { keyPath: "id" });
      if (!request.result.objectStoreNames.contains(CATALOG_STORE)) request.result.createObjectStore(CATALOG_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open remote library storage"));
  });
}

async function storedProviders(): Promise<RemoteProvider[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(PROVIDER_STORE).objectStore(PROVIDER_STORE).getAll();
      request.onsuccess = () => resolve(request.result as RemoteProvider[]);
      request.onerror = () => reject(request.error ?? new Error("Could not load remote providers"));
    });
  } finally {
    database.close();
  }
}

async function persistProvider(provider: RemoteProvider, catalog: Uint8Array): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([PROVIDER_STORE, CATALOG_STORE], "readwrite");
      transaction.objectStore(PROVIDER_STORE).put(provider);
      transaction.objectStore(CATALOG_STORE).put(catalog, provider.id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save remote provider"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not save remote provider"));
    });
  } finally {
    database.close();
  }
}

async function fetchCatalog(url: string, signal?: AbortSignal, onProgress?: DownloadProgressCallback): Promise<Uint8Array> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined_signal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  return new Uint8Array(await downloadArrayBuffer(url, { cache: "no-store", signal: combined_signal }, onProgress));
}

function providerName(url: string): string {
  return new URL(url).hostname;
}

export class RemoteLibraryStore implements Library {
  private readonly listeners = new Set<Listener>();
  private providers: RemoteProviderView[] = [{ ...DEFAULT_REMOTE_PROVIDER, status: "checking", error: null }];
  private readonly ready: Promise<void>;

  constructor() {
    this.ready = storedProviders().then((providers) => {
      this.providers = [DEFAULT_REMOTE_PROVIDER, ...providers.filter((provider) =>
        provider.id !== DEFAULT_REMOTE_PROVIDER.id && provider.catalog_url !== DEFAULT_REMOTE_PROVIDER.catalog_url)]
        .map((provider) => ({ ...provider, status: "checking" as const, error: null }));
      this.emit();
    });
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly RemoteProviderView[] => this.providers;

  async add(value: string): Promise<void> {
    await this.ready;
    const catalog_url = catalogUrl(value);
    if (this.providers.some((provider) => provider.catalog_url === catalog_url)) throw new Error("This provider is already configured");
    const id = crypto.randomUUID();
    const provider: RemoteProvider = { id, catalog_url, name: providerName(catalog_url) };
    this.providers = [...this.providers, { ...provider, status: "checking", error: null }];
    this.emit();
    try {
      const bytes = await fetchCatalog(catalog_url);
      await loadSqliteCatalog(bytes, catalog_url, id);
      await persistProvider(provider, bytes);
      this.update(id, { status: "available", error: null });
    } catch (reason) {
      this.providers = this.providers.filter((candidate) => candidate.id !== id);
      this.emit();
      throw reason;
    }
  }

  async load(signal: AbortSignal, onProgress?: LibraryProgressCallback): Promise<LibraryView> {
    await this.ready;
    const failures: string[] = [];
    const results = await Promise.all(this.providers.map(async (provider) => {
      this.update(provider.id, { status: "checking", error: null });
      try {
        const bytes = await fetchCatalog(provider.catalog_url, signal, (progress) => {
          onProgress?.({ ...progress, id: provider.id, label: `${provider.name} catalog` });
        });
        const library = await loadSqliteCatalog(bytes, provider.catalog_url, provider.id);
        await persistProvider(provider, bytes);
        this.update(provider.id, { status: "available", error: null });
        return library;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "Provider is unavailable";
        failures.push(`${provider.name}: ${message}`);
        this.update(provider.id, { status: "unavailable", error: message });
        return null;
      }
    }));
    if (results.every((result) => result === null)) {
      throw new Error(`Could not load any remote song catalog. ${failures.join("; ")}`);
    }
    return {
      locations: results.flatMap((result) => result?.locations ?? []),
      songs: results.flatMap((result) => result?.songs ?? []),
    };
  }

  private update(id: string, change: Partial<RemoteProviderView>): void {
    this.providers = this.providers.map((provider) => provider.id === id ? { ...provider, ...change } : provider);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
