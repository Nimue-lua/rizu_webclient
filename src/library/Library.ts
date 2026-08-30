import initSqlJs from "sql.js";
import sql_wasm_url from "sql.js/dist/sql-wasm.wasm?url";
import type { ChartfileSetView, Chartview, LibraryView } from "./views";
import { remoteAssetUrl } from "./ProviderUrl";
import type { DownloadProgress } from "../download/Download";

const CATALOG_SCHEMA_VERSION = 8;

export interface Library {
  load(signal: AbortSignal, onProgress?: LibraryProgressCallback): Promise<LibraryView>;
}

export interface LibraryLoadProgress extends DownloadProgress {
  readonly id: string;
  readonly label: string;
}

export type LibraryProgressCallback = (progress: LibraryLoadProgress) => void;

export class CombinedLibrary implements Library {
  constructor(private readonly libraries: readonly Library[]) {}

  async load(signal: AbortSignal, onProgress?: LibraryProgressCallback): Promise<LibraryView> {
    const libraries = await Promise.all(this.libraries.map((library) => library.load(signal, onProgress)));
    const locations: LibraryView["locations"] = [];
    const songs: LibraryView["songs"] = [];
    let next_location_id = 1;
    for (const library of libraries) {
      const location_ids = new Map<number, number>();
      for (const location of library.locations) {
        location_ids.set(location.id, next_location_id);
        locations.push({ ...location, id: next_location_id++ });
      }
      songs.push(...library.songs.map((song) => ({ ...song, charts: song.charts.map((chart) => ({
        ...chart,
        location_id: location_ids.get(chart.location_id) ?? chart.location_id,
      })) })));
    }
    return { locations, songs };
  }
}

export async function loadSqliteCatalog(bytes: Uint8Array, catalog_url: string, source_id: string): Promise<LibraryView> {
    const sql = await initSqlJs({ locateFile: () => sql_wasm_url });
    const database = new sql.Database(bytes);

    try {
      const version_result = database.exec("PRAGMA user_version");
      const schema_version = Number(version_result[0]?.values[0]?.[0] ?? 0);
      if (schema_version !== CATALOG_SCHEMA_VERSION) {
        throw new Error(`Song catalog schema ${schema_version} is incompatible; expected ${CATALOG_SCHEMA_VERSION}. Rebuild the catalog.`);
      }

      const locations_result = database.exec("SELECT id, name FROM locations ORDER BY name COLLATE NOCASE, id");
      const locations = (locations_result[0]?.values ?? []).map(([id, name]) => ({
        id: Number(id),
        name: String(name),
        source_id,
        source_type: "remote" as const,
      }));
      const statement = database.prepare(`
        SELECT songs.id AS song_id, songs.title, songs.artist,
          charts.id, charts.location_id, charts.name, charts.creator, charts.mode, charts.keys,
          charts.duration_seconds, charts.note_count, charts.long_note_ratio,
          charts.bpm_min, charts.bpm_max, charts.bpm_avg, charts.difficulty, charts.format,
          charts.audio_path, charts.preview_seconds, charts.chart_path, charts.background_preview_path
        FROM songs
        JOIN charts ON charts.song_id = songs.id
        ORDER BY songs.title COLLATE NOCASE, songs.artist COLLATE NOCASE, songs.id,
          charts.difficulty, charts.name COLLATE NOCASE, charts.id
      `);
      const songs: ChartfileSetView[] = [];
      const songs_by_id = new Map<string, ChartfileSetView>();

      try {
        while (statement.step()) {
          const row = statement.getAsObject();
          const song_id = `${source_id}:${String(row.song_id)}`;
          let song = songs_by_id.get(song_id);
          if (!song) {
            song = {
              charts: [],
              id: song_id,
              title: String(row.title),
              artist: String(row.artist),
            };
            songs.push(song);
            songs_by_id.set(song_id, song);
          }
          const chart: Chartview = {
            audio_url: remoteAssetUrl(catalog_url, row.audio_path) ?? "",
            background_url: remoteAssetUrl(catalog_url, row.background_preview_path),
            bpm_avg: Number(row.bpm_avg),
            bpm_max: Number(row.bpm_max),
            bpm_min: Number(row.bpm_min),
            creator: String(row.creator),
            chart_url: remoteAssetUrl(catalog_url, row.chart_path) ?? "",
            difficulty: Number(row.difficulty),
            duration_seconds: Number(row.duration_seconds),
            format: String(row.format),
            id: `${source_id}:${String(row.id)}`,
            keys: row.keys === null ? null : Number(row.keys),
            long_note_ratio: Number(row.long_note_ratio),
            location_id: Number(row.location_id),
            mode: Number(row.mode),
            name: String(row.name),
            note_count: Number(row.note_count),
            preview_time: Number(row.preview_seconds),
            source_id,
            source_type: "remote",
          };
          song.charts.push(chart);
        }
      } finally {
        statement.free();
      }

      return { locations, songs };
    } finally {
      database.close();
    }
}
