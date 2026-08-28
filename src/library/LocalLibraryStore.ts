import type { LibraryView } from "./views";
import type { Library } from "./Library";

const DATABASE_NAME = "rizu-local-library";
const DATABASE_VERSION = 1;
const SOURCE_STORE = "sources";
const CATALOG_STORE = "catalog";

export interface LocalLibrarySource {
  readonly id: string;
  readonly name: string;
  readonly handle: FileSystemDirectoryHandle;
}

interface WorkerResponse {
  readonly id?: number;
  readonly type: "ready" | "snapshot" | "scan-status" | "error";
  readonly library?: LibraryView;
  readonly scanning?: boolean;
  readonly message?: string;
}

interface PermissionDirectoryHandle extends FileSystemDirectoryHandle {
  isSameEntry(other: FileSystemHandle): Promise<boolean>;
  queryPermission(options?: { mode: "read" }): Promise<PermissionState>;
  requestPermission(options?: { mode: "read" }): Promise<PermissionState>;
}

type StatusListener = () => void;

export interface LocalLibraryStatus {
  readonly scanning: boolean;
  readonly error: string | null;
  readonly reconnect_required: number;
  readonly sources: readonly { id: string; name: string; available: boolean }[];
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SOURCE_STORE)) {
        request.result.createObjectStore(SOURCE_STORE, { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains(CATALOG_STORE)) {
        request.result.createObjectStore(CATALOG_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local library storage"));
  });
}

async function sourceById(id: string): Promise<LocalLibrarySource | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(SOURCE_STORE).objectStore(SOURCE_STORE).get(id);
      request.onsuccess = () => resolve(request.result as LocalLibrarySource | undefined);
      request.onerror = () => reject(request.error ?? new Error("Could not load local library source"));
    });
  } finally {
    database.close();
  }
}

async function allSources(): Promise<LocalLibrarySource[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(SOURCE_STORE).objectStore(SOURCE_STORE).getAll();
      request.onsuccess = () => resolve(request.result as LocalLibrarySource[]);
      request.onerror = () => reject(request.error ?? new Error("Could not load local library sources"));
    });
  } finally {
    database.close();
  }
}

async function ensureReadPermission(handle: FileSystemDirectoryHandle): Promise<void> {
  const permission_handle = handle as PermissionDirectoryHandle;
  if (typeof permission_handle.queryPermission !== "function") return;
  if (await permission_handle.queryPermission({ mode: "read" }) === "granted") return;
  if (await permission_handle.requestPermission({ mode: "read" }) !== "granted") {
    throw new Error("Read access to the local chart folder was not granted");
  }
}

async function fileAtPath(source_id: string, path: string): Promise<File> {
  const source = await sourceById(source_id);
  if (!source) throw new Error("The local chart source no longer exists");
  let directory = source.handle;
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  const file_name = parts.pop();
  if (!file_name || parts.some((part) => part === "." || part === "..") || file_name === "." || file_name === "..") {
    throw new Error("The local asset path is invalid");
  }
  for (const part of parts) directory = await directory.getDirectoryHandle(part);
  return (await directory.getFileHandle(file_name)).getFile();
}

export function readLocalFile(source_id: string, path: string): Promise<File> {
  return fileAtPath(source_id, path);
}

export async function readLocalAsset(source_id: string, path: string): Promise<ArrayBuffer> {
  return (await fileAtPath(source_id, path)).arrayBuffer();
}

export async function readLocalChart(source_id: string, path: string): Promise<string> {
  return (await fileAtPath(source_id, path)).text();
}

export class LocalLibraryCatalog implements Library {
  private readonly worker = new Worker(new URL("./LocalLibraryWorker.ts", import.meta.url), { type: "module" });
  private readonly pending = new Map<number, { resolve: (library: LibraryView) => void; reject: (reason: unknown) => void }>();
  private readonly listeners = new Set<StatusListener>();
  private request_id = 0;
  private status: LocalLibraryStatus = { scanning: false, error: null, reconnect_required: 0, sources: [] };
  private sources: LocalLibrarySource[] = [];
  private readonly available_source_ids = new Set<string>();
  private readonly sources_ready: Promise<void>;

  constructor() {
    this.sources_ready = this.loadSources();
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.type === "scan-status") {
        this.updateStatus({ scanning: Boolean(response.scanning), error: response.message ?? null });
        for (const listener of this.listeners) listener();
        return;
      }
      if (response.id === undefined) return;
      const request = this.pending.get(response.id);
      if (!request) return;
      this.pending.delete(response.id);
      if (response.type === "snapshot" && response.library) request.resolve(this.availableLibrary(response.library));
      else request.reject(new Error(response.message ?? "Local library worker failed"));
    };
    this.worker.onerror = (event) => {
      this.updateStatus({ scanning: false, error: event.message || "Local library worker failed" });
      for (const request of this.pending.values()) request.reject(new Error(this.status.error ?? "Local library worker failed"));
      this.pending.clear();
      for (const listener of this.listeners) listener();
    };
  }

  subscribe = (listener: StatusListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getStatus = () => this.status;

  private updateStatus(change: Partial<LocalLibraryStatus>): void {
    this.status = { ...this.status, ...change };
  }

  private updateSourceStatus(): void {
    this.updateStatus({
      reconnect_required: this.sources.length - this.available_source_ids.size,
      sources: this.sources.map((source) => ({ id: source.id, name: source.name, available: this.available_source_ids.has(source.id) })),
    });
  }

  private async loadSources(): Promise<void> {
    this.sources = await allSources();
    for (const source of this.sources) {
      const handle = source.handle as PermissionDirectoryHandle;
      if (typeof handle.queryPermission !== "function" || await handle.queryPermission({ mode: "read" }) === "granted") {
        this.available_source_ids.add(source.id);
        this.worker.postMessage({ type: "scan", source });
      }
    }
    this.updateSourceStatus();
    for (const listener of this.listeners) listener();
  }

  async reconnectSources(): Promise<void> {
    await this.sources_ready;
    for (const source of this.sources) {
      if (this.available_source_ids.has(source.id)) continue;
      try {
        await ensureReadPermission(source.handle);
        this.available_source_ids.add(source.id);
        this.worker.postMessage({ type: "scan", source });
      } catch {
        // Denied sources remain configured and can be reconnected in a later session.
      }
    }
    this.updateSourceStatus();
    for (const listener of this.listeners) listener();
  }

  async addSource(handle: FileSystemDirectoryHandle): Promise<void> {
    await ensureReadPermission(handle);
    const permission_handle = handle as PermissionDirectoryHandle;
    const sources = await allSources();
    let existing: LocalLibrarySource | undefined;
    if (typeof permission_handle.isSameEntry === "function") {
      for (const source of sources) {
        if (await permission_handle.isSameEntry(source.handle)) {
          existing = source;
          break;
        }
      }
    }
    const source: LocalLibrarySource = { id: existing?.id ?? crypto.randomUUID(), name: handle.name, handle };
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(SOURCE_STORE, "readwrite");
        transaction.objectStore(SOURCE_STORE).put(source);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Could not save local library source"));
        transaction.onabort = () => reject(transaction.error ?? new Error("Could not save local library source"));
      });
    } finally {
      database.close();
    }
    this.sources = [...this.sources.filter((candidate) => candidate.id !== source.id), source];
    this.available_source_ids.add(source.id);
    this.updateSourceStatus();
    for (const listener of this.listeners) listener();
    this.worker.postMessage({ type: "scan", source });
  }

  snapshot(): Promise<LibraryView> {
    const id = ++this.request_id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: "snapshot", id });
    });
  }

  load(_signal: AbortSignal): Promise<LibraryView> {
    return this.snapshot();
  }

  private availableLibrary(library: LibraryView): LibraryView {
    const songs = library.songs.flatMap((song) => {
      const charts = song.charts.filter((chart) => chart.source_id && this.available_source_ids.has(chart.source_id));
      return charts.length > 0 ? [{ ...song, charts }] : [];
    });
    const location_ids = new Set(songs.flatMap((song) => song.charts.map((chart) => chart.location_id)));
    return { locations: library.locations.filter((location) => location_ids.has(location.id)), songs };
  }

  pause(): void {
    this.worker.postMessage({ type: "pause" });
  }

  resume(): void {
    this.worker.postMessage({ type: "resume" });
  }

  destroy(): void {
    this.worker.terminate();
    this.listeners.clear();
  }
}
