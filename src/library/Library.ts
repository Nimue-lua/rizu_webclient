import initSqlJs from "sql.js";
import sql_wasm_url from "sql.js/dist/sql-wasm.wasm?url";
import type { ChartfileSetView, Chartview, LibraryView } from "./views";

const CATALOG_SCHEMA_VERSION = 6;

export interface Library {
  load(signal: AbortSignal): Promise<LibraryView>;
}

function assetUrl(asset_path: unknown): string | null {
  if (typeof asset_path !== "string") return null;
  return `/${asset_path.split("/").map(encodeURIComponent).join("/")}`;
}

export class SqliteLibrary implements Library {
  async load(signal: AbortSignal): Promise<LibraryView> {
    const [sql, response] = await Promise.all([
      initSqlJs({ locateFile: () => sql_wasm_url }),
      fetch("/catalog.sqlite", { cache: "no-cache", signal }),
    ]);

    if (!response.ok) {
      throw new Error(`Failed to fetch song catalog: ${response.status} ${response.statusText}`);
    }

    const database = new sql.Database(new Uint8Array(await response.arrayBuffer()));

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
      }));
      const statement = database.prepare(`
        SELECT songs.id AS song_id, songs.title, songs.artist,
          charts.id, charts.location_id, charts.name, charts.creator, charts.mode, charts.keys,
          charts.duration_seconds, charts.note_count, charts.long_note_ratio,
          charts.bpm_min, charts.bpm_max, charts.bpm_avg, charts.difficulty, charts.format,
          charts.audio_path, charts.chart_path, charts.background_preview_path
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
          const song_id = String(row.song_id);
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
            audio_url: assetUrl(row.audio_path) ?? "",
            background_url: assetUrl(row.background_preview_path),
            bpm_avg: Number(row.bpm_avg),
            bpm_max: Number(row.bpm_max),
            bpm_min: Number(row.bpm_min),
            creator: String(row.creator),
            chart_url: assetUrl(row.chart_path) ?? "",
            difficulty: Number(row.difficulty),
            duration_seconds: Number(row.duration_seconds),
            format: String(row.format),
            id: String(row.id),
            keys: row.keys === null ? null : Number(row.keys),
            long_note_ratio: Number(row.long_note_ratio),
            location_id: Number(row.location_id),
            mode: Number(row.mode),
            name: String(row.name),
            note_count: Number(row.note_count),
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
}
