import path from "node:path";
import { fileURLToPath } from "node:url";
import { cacheCharts } from "./chart-catalog.mjs";

const server_directory = path.dirname(fileURLToPath(import.meta.url));
const root_directory = path.dirname(server_directory);

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? path.resolve(process.argv[index + 1] ?? "") : fallback;
}

const result = await cacheCharts({
  charts_directory: readOption("--charts", path.join(root_directory, "public/charts")),
  client_database: readOption("--client-database", path.join(root_directory, "public/catalog.sqlite")),
  server_database: readOption("--server-database", path.join(server_directory, "catalog.sqlite")),
  schema_directory: server_directory,
});

console.log(`Cached ${result.songs.length} songs and ${result.charts.length} charts (${result.skipped} skipped).`);
console.log(`Catalog version: ${result.version}`);
