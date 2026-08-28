/// <reference lib="webworker" />

import initSqlJs, { type Database } from "sql.js";
import sql_wasm_url from "sql.js/dist/sql-wasm.wasm?url";
import { parseOsuChart } from "../chart/format/osu/OsuParser";
import { calculateManiaDifficulty } from "../gameplay/mania/scoring/ManiaDifficulty";
import { calculateOsuDifficulty } from "../gameplay/osu/scoring/OsuDifficulty";
import type { ChartfileSetView, Chartview, LibraryView } from "./views";
import { md5 } from "./md5";

const DATABASE_NAME = "rizu-local-library";
const DATABASE_VERSION = 1;
const SOURCE_STORE = "sources";
const CATALOG_STORE = "catalog";
const CATALOG_KEY = "sqlite";
const PERSIST_BATCH_SIZE = 20;

interface LocalLibrarySource {
  readonly id: string;
  readonly name: string;
  readonly handle: FileSystemDirectoryHandle;
}

interface ChartFile {
  readonly file: File;
  readonly path: string;
}

let database: Database;
let paused = false;
let scanning = false;
let pending_scan = false;
const queued_sources: LocalLibrarySource[] = [];

function openStorage(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SOURCE_STORE)) request.result.createObjectStore(SOURCE_STORE, { keyPath: "id" });
      if (!request.result.objectStoreNames.contains(CATALOG_STORE)) request.result.createObjectStore(CATALOG_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local library storage"));
  });
}

async function storedCatalog(): Promise<Uint8Array | null> {
  const storage = await openStorage();
  try {
    return await new Promise((resolve, reject) => {
      const request = storage.transaction(CATALOG_STORE).objectStore(CATALOG_STORE).get(CATALOG_KEY);
      request.onsuccess = () => resolve(request.result instanceof Uint8Array ? request.result : null);
      request.onerror = () => reject(request.error ?? new Error("Could not load the local catalog"));
    });
  } finally {
    storage.close();
  }
}

async function persistCatalog(): Promise<void> {
  const bytes = database.export();
  const storage = await openStorage();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = storage.transaction(CATALOG_STORE, "readwrite");
      transaction.objectStore(CATALOG_STORE).put(bytes, CATALOG_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the local catalog"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not save the local catalog"));
    });
  } finally {
    storage.close();
  }
}

function createSchema(): void {
  database.run(`
    PRAGMA user_version = 1;
    CREATE TABLE sources (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE locations (id INTEGER PRIMARY KEY, source_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, path TEXT NOT NULL);
    CREATE TABLE chartfile_sets (id INTEGER PRIMARY KEY, location_id INTEGER NOT NULL, dir TEXT, name TEXT NOT NULL, modified_at INTEGER NOT NULL, UNIQUE(location_id, dir, name));
    CREATE TABLE chartfiles (id INTEGER PRIMARY KEY, set_id INTEGER NOT NULL, name TEXT NOT NULL, modified_at INTEGER NOT NULL, hash TEXT NOT NULL, UNIQUE(set_id, name));
    CREATE TABLE chartmetas (
      id INTEGER PRIMARY KEY, hash TEXT NOT NULL, \`index\` INTEGER NOT NULL, inputmode TEXT NOT NULL, format INTEGER NOT NULL,
      title TEXT, title_unicode TEXT, artist TEXT, artist_unicode TEXT, name TEXT, creator TEXT, level REAL,
      source TEXT, tags TEXT, audio_path TEXT, audio_offset REAL, background_path TEXT, preview_time REAL,
      osu_beatmap_id INTEGER, osu_beatmapset_id INTEGER, tempo REAL, tempo_avg REAL, tempo_max REAL, tempo_min REAL,
      UNIQUE(hash, \`index\`)
    );
    CREATE TABLE chartdiffs (
      id INTEGER PRIMARY KEY, hash TEXT NOT NULL, \`index\` INTEGER NOT NULL, mode INTEGER NOT NULL, inputmode TEXT NOT NULL,
      duration REAL NOT NULL, notes_count INTEGER NOT NULL, judges_count INTEGER NOT NULL, difficulty REAL NOT NULL,
      UNIQUE(hash, \`index\`)
    );
  `);
}

function property(source: string, name: string): string {
  return source.match(new RegExp(`^${name}:\\s*(.*?)\\r?$`, "m"))?.[1]?.trim() ?? "";
}

function backgroundFile(source: string): string | null {
  const events = source.match(/^\[Events\][^\S\r\n]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1] ?? "";
  return events.match(/^(?:0|Background),0,"([^"]+)"/m)?.[1] ?? null;
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function resolvePath(chart_path: string, asset_path: string): string {
  const separator = chart_path.lastIndexOf("/");
  return normalizePath((separator < 0 ? "" : chart_path.slice(0, separator + 1)) + asset_path);
}

async function *chartFiles(directory: FileSystemDirectoryHandle, parent = ""): AsyncGenerator<ChartFile> {
  for await (const [name, handle] of directory.entries()) {
    const path = parent ? `${parent}/${name}` : name;
    if (handle.kind === "directory") yield* chartFiles(handle, path);
    else if (/\.osu$/i.test(name)) yield { file: await handle.getFile(), path };
  }
}

function locationId(source: LocalLibrarySource): number {
  database.run("INSERT OR IGNORE INTO sources (id, name) VALUES (?, ?)", [source.id, source.name]);
  database.run("INSERT OR IGNORE INTO locations (source_id, name, path) VALUES (?, ?, ?)", [source.id, source.name, "."]);
  const result = database.exec("SELECT id FROM locations WHERE source_id = ?", [source.id]);
  return Number(result[0]?.values[0]?.[0]);
}

function upsertChart(source: LocalLibrarySource, location_id: number, chart_file: ChartFile, source_text: string, hash: string): void {
  const parsed = parseOsuChart(source_text);
  const slash = chart_file.path.lastIndexOf("/");
  const dir = slash < 0 ? "" : chart_file.path.slice(0, slash);
  const file_name = slash < 0 ? chart_file.path : chart_file.path.slice(slash + 1);
  const set_name = dir.split("/").at(-1) || source.name;
  database.run("INSERT OR IGNORE INTO chartfile_sets (location_id, dir, name, modified_at) VALUES (?, ?, ?, ?)",
    [location_id, dir, set_name, chart_file.file.lastModified]);
  const set_result = database.exec("SELECT id FROM chartfile_sets WHERE location_id = ? AND dir = ? AND name = ?", [location_id, dir, set_name]);
  const set_id = Number(set_result[0]?.values[0]?.[0]);
  const old_hash_result = database.exec("SELECT hash FROM chartfiles WHERE set_id = ? AND name = ?", [set_id, file_name]);
  const old_hash = old_hash_result[0]?.values[0]?.[0];
  database.run(`INSERT INTO chartfiles (set_id, name, modified_at, hash) VALUES (?, ?, ?, ?)
    ON CONFLICT(set_id, name) DO UPDATE SET modified_at = excluded.modified_at, hash = excluded.hash`,
  [set_id, file_name, chart_file.file.lastModified, hash]);

  const mode = parsed.mode === "mania" ? 3 : 0;
  const inputmode = parsed.mode === "mania" ? `${parsed.column_count}key` : "osu";
  const note_count = parsed.mode === "osu" ? parsed.object_count : parsed.notes.filter((note) => note.weight >= 0).length;
  const judges_count = parsed.mode === "osu" ? note_count : parsed.notes.length;
  const first_time = parsed.mode === "osu" ? parsed.hit_objects[0]?.absolute_time ?? 0 : parsed.notes[0]?.absolute_time ?? 0;
  const last_time = parsed.mode === "osu" ? parsed.end_time : parsed.notes.at(-1)?.absolute_time ?? first_time;
  const difficulty = parsed.mode === "osu" ? calculateOsuDifficulty(parsed) : calculateManiaDifficulty(parsed);
  const audio_path = resolvePath(chart_file.path, property(source_text, "AudioFilename"));
  if (!audio_path) throw new Error("Chart has no AudioFilename");
  const background_name = backgroundFile(source_text);
  if (old_hash && old_hash !== hash) {
    database.run("DELETE FROM chartmetas WHERE hash = ?", [old_hash]);
    database.run("DELETE FROM chartdiffs WHERE hash = ?", [old_hash]);
  }
  database.run("DELETE FROM chartmetas WHERE hash = ?", [hash]);
  database.run("DELETE FROM chartdiffs WHERE hash = ?", [hash]);
  database.run(`INSERT INTO chartmetas (hash, \`index\`, inputmode, format, title, title_unicode, artist, artist_unicode,
    name, creator, level, source, tags, audio_path, audio_offset, background_path, preview_time, osu_beatmap_id,
    osu_beatmapset_id, tempo, tempo_avg, tempo_max, tempo_min) VALUES (?, 1, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    hash, inputmode, property(source_text, "Title"), property(source_text, "TitleUnicode"), property(source_text, "Artist"),
    property(source_text, "ArtistUnicode"), property(source_text, "Version"), property(source_text, "Creator"), difficulty,
    property(source_text, "Source"), property(source_text, "Tags"), audio_path,
    background_name ? resolvePath(chart_file.path, background_name) : null, Number(property(source_text, "PreviewTime") || 0) / 1000,
    Number(property(source_text, "BeatmapID")) || null, Number(property(source_text, "BeatmapSetID")) || null,
    parsed.primary_tempo, parsed.primary_tempo, parsed.primary_tempo, parsed.primary_tempo,
  ]);
  database.run(`INSERT INTO chartdiffs (hash, \`index\`, mode, inputmode, duration, notes_count, judges_count, difficulty)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?)`, [hash, mode, inputmode, Math.max(0, last_time - first_time), note_count, judges_count, difficulty]);
}

async function scanSource(source: LocalLibrarySource): Promise<void> {
  const location_id = locationId(source);
  let processed = 0;
  for await (const chart_file of chartFiles(source.handle)) {
    while (paused) await new Promise((resolve) => setTimeout(resolve, 100));
    const existing = database.exec(`SELECT chartfiles.modified_at FROM chartfiles JOIN chartfile_sets ON chartfile_sets.id = chartfiles.set_id
      WHERE chartfile_sets.location_id = ? AND chartfile_sets.dir = ? AND chartfiles.name = ?`, [location_id,
      chart_file.path.includes("/") ? chart_file.path.slice(0, chart_file.path.lastIndexOf("/")) : "",
      chart_file.path.split("/").at(-1)!]);
    if (Number(existing[0]?.values[0]?.[0]) === chart_file.file.lastModified) continue;
    try {
      const bytes = new Uint8Array(await chart_file.file.arrayBuffer());
      upsertChart(source, location_id, chart_file, new TextDecoder().decode(bytes), md5(bytes));
      processed += 1;
      if (processed % PERSIST_BATCH_SIZE === 0) await persistCatalog();
    } catch (reason) {
      console.warn(`Could not cache local chart ${chart_file.path}`, reason);
    }
  }
  await persistCatalog();
}

function librarySnapshot(): LibraryView {
  const locations_result = database.exec("SELECT id, name FROM locations ORDER BY name COLLATE NOCASE, id");
  const locations = (locations_result[0]?.values ?? []).map(([id, name]) => ({
    id: Number(id), name: String(name), source_type: "local" as const,
  }));
  const result = database.exec(`SELECT locations.source_id, locations.id AS location_id, chartfile_sets.dir, chartfiles.name AS chartfile_name,
    chartmetas.hash, chartmetas.\`index\`, chartmetas.inputmode, chartmetas.title, chartmetas.title_unicode,
    chartmetas.artist, chartmetas.artist_unicode, chartmetas.name, chartmetas.creator, chartmetas.level, chartmetas.audio_path,
    chartmetas.background_path, chartmetas.preview_time, chartmetas.tempo_avg, chartmetas.tempo_max, chartmetas.tempo_min,
    chartdiffs.mode, chartdiffs.duration, chartdiffs.notes_count, chartdiffs.judges_count
    FROM chartfiles JOIN chartfile_sets ON chartfile_sets.id = chartfiles.set_id
    JOIN locations ON locations.id = chartfile_sets.location_id JOIN chartmetas ON chartmetas.hash = chartfiles.hash
    JOIN chartdiffs ON chartdiffs.hash = chartmetas.hash AND chartdiffs.\`index\` = chartmetas.\`index\`
    ORDER BY chartmetas.title COLLATE NOCASE, chartmetas.artist COLLATE NOCASE, chartmetas.level`);
  const songs: ChartfileSetView[] = [];
  const songs_by_id = new Map<string, ChartfileSetView>();
  if (!result[0]) return { locations, songs };
  for (const values of result[0].values) {
    const row = Object.fromEntries(result[0].columns.map((column, index) => [column, values[index]]));
    const source_id = String(row.source_id);
    const dir = String(row.dir ?? "");
    const chart_path = dir ? `${dir}/${String(row.chartfile_name)}` : String(row.chartfile_name);
    const title = String(row.title_unicode || row.title || "Unknown title");
    const artist = String(row.artist_unicode || row.artist || "Unknown artist");
    const song_id = `${source_id}:${dir}:${title}:${artist}`;
    let song = songs_by_id.get(song_id);
    if (!song) {
      song = { id: song_id, title, artist, charts: [] };
      songs_by_id.set(song_id, song);
      songs.push(song);
    }
    const inputmode = String(row.inputmode);
    const chart: Chartview = {
      id: `${source_id}:${String(row.hash)}:${Number(row.index)}`,
      source_id,
      source_type: "local",
      audio_path: String(row.audio_path),
      background_path: row.background_path ? String(row.background_path) : undefined,
      chart_path,
      preview_time: Math.max(0, Number(row.preview_time) || 0),
      audio_url: "",
      background_url: null,
      bpm_avg: Number(row.tempo_avg), bpm_max: Number(row.tempo_max), bpm_min: Number(row.tempo_min),
      creator: String(row.creator || "Unknown creator"), difficulty: Number(row.level), duration_seconds: Number(row.duration),
      format: "osu", keys: /^\d+key$/.test(inputmode) ? Number.parseInt(inputmode) : null,
      location_id: Number(row.location_id), long_note_ratio: Number(row.notes_count) > 0
        ? Math.max(0, Number(row.judges_count) - Number(row.notes_count)) / Number(row.notes_count) : 0,
      mode: Number(row.mode), name: String(row.name || "Unknown difficulty"), note_count: Number(row.notes_count), chart_url: "",
    };
    song.charts.push(chart);
  }
  return { locations, songs };
}

async function processQueue(): Promise<void> {
  if (scanning) return;
  scanning = true;
  postMessage({ type: "scan-status", scanning: true });
  try {
    while (queued_sources.length > 0) await scanSource(queued_sources.shift()!);
    pending_scan = false;
    postMessage({ type: "scan-status", scanning: false });
  } catch (reason) {
    postMessage({ type: "scan-status", scanning: false, message: reason instanceof Error ? reason.message : "Local library scan failed" });
  } finally {
    scanning = false;
  }
}

async function initialize(): Promise<void> {
  const sql = await initSqlJs({ locateFile: () => sql_wasm_url });
  const bytes = await storedCatalog();
  database = bytes ? new sql.Database(bytes) : new sql.Database();
  if (!bytes) {
    createSchema();
    await persistCatalog();
  }
}

const ready = initialize();
self.onmessage = (event: MessageEvent) => {
  void ready.then(async () => {
    const message = event.data as { type: string; id?: number; source?: LocalLibrarySource };
    if (message.type === "scan" && message.source) {
      queued_sources.push(message.source);
      pending_scan = true;
      void processQueue();
    } else if (message.type === "pause") {
      paused = true;
      if (pending_scan) await persistCatalog();
    } else if (message.type === "resume") {
      paused = false;
      void processQueue();
    } else if (message.type === "snapshot" && message.id !== undefined) {
      await persistCatalog();
      postMessage({ type: "snapshot", id: message.id, library: librarySnapshot() });
    }
  }).catch((reason) => {
    postMessage({ type: "error", id: event.data?.id, message: reason instanceof Error ? reason.message : "Local library worker failed" });
  });
};
