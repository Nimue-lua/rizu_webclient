import { createHash } from "node:crypto";
import { access, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 1;

function readProperty(source, name) {
  return source.match(new RegExp(`^${name}:\\s*(.*?)\\r?$`, "m"))?.[1]?.trim() ?? "";
}

function readNumber(source, name) {
  const value = Number(readProperty(source, name));
  return Number.isFinite(value) ? value : null;
}

function readBackground(source) {
  const events = source.match(/^\[Events\][^\S\r\n]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1] ?? "";
  return events.match(/^0,0,"([^"]+)"/m)?.[1] ?? null;
}

function fallbackId(prefix, value) {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function safeFileName(value) {
  return value !== "" && path.basename(value) === value ? value : null;
}

async function readableFile(file_path) {
  try {
    await access(file_path);
    return true;
  } catch {
    return false;
  }
}

export function parseOsuMetadata(source, folder, chart_file) {
  const mode = readNumber(source, "Mode");
  const keys = readNumber(source, "CircleSize");
  const audio_file = safeFileName(readProperty(source, "AudioFilename"));
  const background_file = safeFileName(readBackground(source) ?? "");
  const beatmap_id = readNumber(source, "BeatmapID");
  const beatmap_set_id = readNumber(source, "BeatmapSetID");
  const song_id = beatmap_set_id && beatmap_set_id > 0
    ? String(beatmap_set_id)
    : fallbackId("set", folder);
  const chart_id = beatmap_id && beatmap_id > 0
    ? String(beatmap_id)
    : fallbackId("chart", `${folder}/${chart_file}`);

  return {
    song_id,
    chart_id,
    beatmap_id: beatmap_id && beatmap_id > 0 ? beatmap_id : null,
    title: readProperty(source, "Title") || folder,
    title_unicode: readProperty(source, "TitleUnicode"),
    artist: readProperty(source, "Artist") || "Unknown Artist",
    artist_unicode: readProperty(source, "ArtistUnicode"),
    source: readProperty(source, "Source"),
    tags: readProperty(source, "Tags"),
    preview_seconds: Math.max(0, (readNumber(source, "PreviewTime") ?? 0) / 1000),
    name: readProperty(source, "Version") || path.basename(chart_file, path.extname(chart_file)),
    creator: readProperty(source, "Creator"),
    mode,
    keys,
    audio_file,
    background_file,
  };
}

async function scanCharts(charts_directory) {
  const songs = new Map();
  const charts = [];
  let skipped = 0;
  const folders = (await readdir(charts_directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const folder of folders) {
    const folder_path = path.join(charts_directory, folder);
    const chart_files = (await readdir(folder_path))
      .filter((file) => file.toLowerCase().endsWith(".osu"))
      .sort();

    for (const chart_file of chart_files) {
      const source = await readFile(path.join(folder_path, chart_file), "utf8");
      const metadata = parseOsuMetadata(source, folder, chart_file);

      if (metadata.mode !== 3 || !Number.isInteger(metadata.keys) || metadata.keys <= 0 || !metadata.audio_file) {
        skipped += 1;
        continue;
      }

      const audio_path = path.join(folder_path, metadata.audio_file);
      if (!await readableFile(audio_path)) {
        skipped += 1;
        continue;
      }

      const background_file = metadata.background_file
        && await readableFile(path.join(folder_path, metadata.background_file))
        ? metadata.background_file
        : null;
      const song = songs.get(metadata.song_id);
      if (!song) {
        songs.set(metadata.song_id, {
          ...metadata,
          audio_path: path.posix.join("charts", folder, metadata.audio_file),
          background_path: background_file ? path.posix.join("charts", folder, background_file) : null,
        });
      }

      charts.push({
        ...metadata,
        chart_path: path.posix.join("charts", folder, chart_file),
      });
    }
  }

  return { songs: [...songs.values()], charts, skipped };
}

function writeDatabases(client_path, server_path, client_schema, server_schema, data, generated_at) {
  const version_hash = createHash("sha256");
  for (const chart of data.charts) {
    version_hash.update(`${chart.chart_id}\0${chart.chart_path}\0`);
  }
  const version = version_hash.digest("hex");
  const client_db = new DatabaseSync(client_path);
  const server_db = new DatabaseSync(server_path);

  try {
    client_db.exec(client_schema);
    server_db.exec(server_schema);
    client_db.prepare("INSERT INTO catalog VALUES (?, ?, ?)").run(SCHEMA_VERSION, version, generated_at);
    server_db.prepare("INSERT INTO catalog VALUES (?, ?, ?)").run(SCHEMA_VERSION, version, generated_at);

    const insert_client_song = client_db.prepare("INSERT INTO songs VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const insert_server_song = server_db.prepare("INSERT INTO songs VALUES (?, ?, ?, ?, ?, ?)");
    const insert_client_chart = client_db.prepare("INSERT INTO charts VALUES (?, ?, ?, ?, ?, ?, ?)");
    const insert_server_chart = server_db.prepare("INSERT INTO charts VALUES (?, ?, ?, ?, ?, ?, ?)");

    client_db.exec("BEGIN");
    server_db.exec("BEGIN");
    for (const song of data.songs) {
      insert_client_song.run(song.song_id, song.title, song.title_unicode, song.artist, song.artist_unicode, song.source, song.tags, song.preview_seconds);
      insert_server_song.run(song.song_id, song.title, song.artist, song.preview_seconds, song.audio_path, song.background_path);
    }
    for (const chart of data.charts) {
      insert_client_chart.run(chart.chart_id, chart.song_id, chart.name, chart.creator, chart.mode, chart.keys, chart.beatmap_id);
      insert_server_chart.run(chart.chart_id, chart.song_id, chart.name, chart.creator, chart.mode, chart.keys, chart.chart_path);
    }
    client_db.exec("COMMIT");
    server_db.exec("COMMIT");
  } finally {
    client_db.close();
    server_db.close();
  }

  return version;
}

export async function cacheCharts({ charts_directory, client_database, server_database, schema_directory }) {
  const client_temp = `${client_database}.tmp`;
  const server_temp = `${server_database}.tmp`;
  await Promise.all([rm(client_temp, { force: true }), rm(server_temp, { force: true })]);

  try {
    const [data, client_schema, server_schema] = await Promise.all([
      scanCharts(charts_directory),
      readFile(path.join(schema_directory, "client-catalog.sql"), "utf8"),
      readFile(path.join(schema_directory, "server-catalog.sql"), "utf8"),
    ]);
    const generated_at = Math.floor(Date.now() / 1000);
    const version = writeDatabases(client_temp, server_temp, client_schema, server_schema, data, generated_at);
    await rename(client_temp, client_database);
    await rename(server_temp, server_database);
    return { ...data, version };
  } catch (reason) {
    await Promise.all([rm(client_temp, { force: true }), rm(server_temp, { force: true })]);
    throw reason;
  }
}
