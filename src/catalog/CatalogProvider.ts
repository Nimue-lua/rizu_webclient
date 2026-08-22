import initSqlJs from "sql.js";
import sql_wasm_url from "sql.js/dist/sql-wasm.wasm?url";

export interface CatalogSong {
  id: string;
  preview_chart_id: string;
  title: string;
  artist: string;
}

export interface CatalogProvider {
  getSongs(signal: AbortSignal): Promise<CatalogSong[]>;
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
        SELECT songs.id, songs.title, songs.artist, MIN(charts.id) AS preview_chart_id
        FROM songs
        JOIN charts ON charts.song_id = songs.id
        GROUP BY songs.id
        ORDER BY songs.title COLLATE NOCASE, songs.artist COLLATE NOCASE, songs.id
      `);
      const songs: CatalogSong[] = [];

      try {
        while (statement.step()) {
          const row = statement.getAsObject();
          songs.push({
            id: String(row.id),
            preview_chart_id: String(row.preview_chart_id),
            title: String(row.title),
            artist: String(row.artist),
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
