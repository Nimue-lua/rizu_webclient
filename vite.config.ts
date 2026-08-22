import path from "node:path";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const catalog_path = path.resolve(import.meta.dirname, "server/catalog.sqlite");

function encodeAssetUrl(...segments: string[]) {
  return `/${segments.map(encodeURIComponent).join("/")}`;
}

function getChart(database: DatabaseSync, chart_id: string) {
  const chart = database.prepare(`
    SELECT songs.audio_path, charts.chart_path
    FROM charts
    JOIN songs ON songs.id = charts.song_id
    WHERE charts.id = ?
  `).get(chart_id) as { audio_path: string; chart_path: string } | undefined;

  if (!chart) {
    return null;
  }

  return {
    audio_url: encodeAssetUrl(...chart.audio_path.split("/")),
    chart_url: encodeAssetUrl(...chart.chart_path.split("/")),
  };
}

export default defineConfig({
  build: {
    copyPublicDir: false,
  },
  server: {
    proxy: {
      "/api/preview": {
        target: "http://127.0.0.1:8090",
      },
    },
  },
  plugins: [
    react(),
    {
      name: "public-logo",
      buildStart() {
        this.emitFile({
          type: "asset",
          fileName: "rizu-logo.svg",
          source: readFileSync(path.resolve(import.meta.dirname, "public/rizu-logo.svg")),
        });
      },
    },
    {
      name: "development-chart-catalog",
      configureServer(server) {
        let database: DatabaseSync | null = null;
        server.middlewares.use("/api/charts/", async (request, response) => {
          try {
            database ??= new DatabaseSync(catalog_path, { readOnly: true });
            const chart_id = decodeURIComponent(request.url?.slice(1).split("?", 1)[0] ?? "");
            const chart = getChart(database, chart_id);
            if (!chart) {
              response.statusCode = 404;
              response.end("Selected chart was not found");
              return;
            }
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify(chart));
          } catch (reason) {
            response.statusCode = 500;
            response.end(reason instanceof Error
              ? `${reason.message}. Run npm run cache:charts if the catalog has not been built.`
              : "Failed to select chart");
          }
        });
        server.httpServer?.once("close", () => database?.close());
      },
    },
  ],
});
