import initSqlJs from "sql.js";
import sql_wasm_url from "sql.js/dist/sql-wasm.wasm?url";

export interface CatalogChart {
  bpm_avg: number;
  bpm_max: number;
  bpm_min: number;
  creator: string;
  difficulty: number;
  duration_seconds: number;
  format: string;
  id: string;
  keys: number | null;
  long_note_ratio: number;
  mode: number;
  name: string;
  note_count: number;
}

export interface CatalogSong {
  background_url: string | null;
  charts: CatalogChart[];
  id: string;
  title: string;
  artist: string;
}

export interface CatalogProvider {
  getSongs(signal: AbortSignal): Promise<CatalogSong[]>;
}

function assetUrl(asset_path: unknown): string | null {
  if (typeof asset_path !== "string") return null;
  return `/${asset_path.split("/").map(encodeURIComponent).join("/")}`;
}

export class SqliteCatalogProvider implements CatalogProvider {
  async getSongs(signal: AbortSignal): Promise<CatalogSong[]> {
    const [sql, response] = await Promise.all([
      initSqlJs({ locateFile: () => sql_wasm_url }),
      fetch("/catalog.sqlite", { signal }),
    ]);

    if (!response.ok) {
      throw new Error(`Failed to fetch song catalog: ${response.status} ${response.statusText}`);
    }

    const database = new sql.Database(new Uint8Array(await response.arrayBuffer()));

    try {
      const statement = database.prepare(`
        SELECT songs.id AS song_id, songs.title, songs.artist, songs.background_preview_path,
          charts.id, charts.name, charts.creator, charts.mode, charts.keys,
          charts.duration_seconds, charts.note_count, charts.long_note_ratio,
          charts.bpm_min, charts.bpm_max, charts.bpm_avg, charts.difficulty, charts.format
        FROM songs
        JOIN charts ON charts.song_id = songs.id
        ORDER BY songs.title COLLATE NOCASE, songs.artist COLLATE NOCASE, songs.id,
          charts.difficulty, charts.name COLLATE NOCASE, charts.id
      `);
      const songs: CatalogSong[] = [];
      const songs_by_id = new Map<string, CatalogSong>();

      try {
        while (statement.step()) {
          const row = statement.getAsObject();
          const song_id = String(row.song_id);
          let song = songs_by_id.get(song_id);
          if (!song) {
            song = {
              background_url: assetUrl(row.background_preview_path),
              charts: [],
              id: song_id,
              title: String(row.title),
              artist: String(row.artist),
            };
            songs.push(song);
            songs_by_id.set(song_id, song);
          }
          song.charts.push({
            bpm_avg: Number(row.bpm_avg),
            bpm_max: Number(row.bpm_max),
            bpm_min: Number(row.bpm_min),
            creator: String(row.creator),
            difficulty: Number(row.difficulty),
            duration_seconds: Number(row.duration_seconds),
            format: String(row.format),
            id: String(row.id),
            keys: row.keys === null ? null : Number(row.keys),
            long_note_ratio: Number(row.long_note_ratio),
            mode: Number(row.mode),
            name: String(row.name),
            note_count: Number(row.note_count),
          });
        }
      } finally {
        statement.free();
      }

      return songs;
    } finally {
      database.close();
    }
  }
}
