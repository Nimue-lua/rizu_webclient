import path from "node:path";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cacheCharts, gameplayAssetManifest } from "./chart-catalog.mjs";

const server_directory = path.dirname(fileURLToPath(import.meta.url));
const root_directory = path.dirname(server_directory);
const charts_directory = readOption("--charts", path.join(root_directory, "library/charts"));
const generate_previews = !process.argv.includes("--skip-previews");
const write_database = !process.argv.includes("--skip-database");

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? path.resolve(process.argv[index + 1] ?? "") : fallback;
}

function readValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? "" : fallback;
}

const result = await cacheCharts({
  charts_directory,
  background_previews_directory: readOption("--background-previews", path.join(path.dirname(charts_directory), "chart-previews")),
  audio_previews_directory: readOption("--audio-previews", path.join(path.dirname(charts_directory), "audio-previews")),
  client_database: readOption("--client-database", path.join(root_directory, "library/catalog.sqlite")),
  schema_directory: server_directory,
  ffmpeg_path: readValue("--ffmpeg", "ffmpeg"),
  generate_previews,
  write_database,
});

const asset_manifest = readOption("--asset-manifest", "");
if (asset_manifest) {
  await writeFile(asset_manifest, gameplayAssetManifest(result.charts));
}

console.log(`Cached ${result.locations.length} locations, ${result.songs.length} songs, and ${result.charts.length} charts (${result.skipped} skipped).`);
if (result.version) console.log(`Catalog version: ${result.version}`);
