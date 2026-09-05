import type { DatabaseSync } from "node:sqlite";
import type { CatalogChartRow } from "./types.ts";

export function catalogChart(catalog: DatabaseSync, chart_md5: string, chart_index: number): CatalogChartRow | undefined {
  return catalog.prepare(`
    SELECT charts.difficulty, charts.speed, charts.dexterity, charts.stamina, charts.technical,
      charts.duration_seconds, charts.mode, charts.keys, charts.name, charts.background_preview_path,
      songs.title, songs.artist
    FROM charts JOIN songs ON songs.id = charts.song_id
    WHERE charts.chart_md5 = ? AND charts.chart_index = ?
  `).get(chart_md5.toLowerCase(), chart_index) as unknown as CatalogChartRow | undefined;
}
