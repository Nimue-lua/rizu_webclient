import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 7;
const AUDIO_PREVIEW_DURATION_SECONDS = 10;
const AUDIO_PREVIEW_PROFILE = "webm-opus-mono-32k-v1";
const execFileAsync = promisify(execFile);

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

function readSection(source, name) {
  return source.match(new RegExp(`^\\[${name}\\][^\\S\\r\\n]*\\r?\\n([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, "m"))?.[1] ?? "";
}

function parseTimingPoints(source) {
  return readSection(source, "TimingPoints").split(/\r?\n/).flatMap((line) => {
    const fields = line.trim().split(",");
    const offset = Number(fields[0]);
    const beat_length = Number(fields[1]);
    const uninherited = fields[6] === undefined ? beat_length > 0 : Number(fields[6]) === 1;
    return Number.isFinite(offset) && Number.isFinite(beat_length)
      ? [{ offset, beat_length, uninherited }]
      : [];
  }).sort((left, right) => left.offset - right.offset);
}

function sliderEndTime(start_time, fields, timing_points, slider_multiplier) {
  const repeats = Number(fields[6]);
  const pixel_length = Number(fields[7]);
  if (!(repeats > 0) || !(pixel_length >= 0) || !(slider_multiplier > 0)) return start_time;

  let beat_length = 0;
  let speed_multiplier = 1;
  for (const point of timing_points) {
    if (point.offset > start_time) break;
    if (point.uninherited && point.beat_length > 0) beat_length = point.beat_length;
    else if (!point.uninherited && point.beat_length < 0) {
      speed_multiplier = Math.min(Math.max(-100 / point.beat_length, 0.1), 10);
    }
  }
  return beat_length > 0
    ? start_time + (pixel_length * repeats * beat_length) / (slider_multiplier * 100 * speed_multiplier)
    : start_time;
}

function computeBpm(timing_points, start_time, end_time) {
  const tempo_points = timing_points.filter((point) => point.uninherited && point.beat_length > 0);
  if (tempo_points.length === 0) return { bpm_min: 0, bpm_max: 0, bpm_avg: 0 };

  const bpms = tempo_points.map((point) => 60000 / point.beat_length);
  let weighted_bpm = 0;
  let weighted_duration = 0;
  for (let index = 0; index < tempo_points.length; index += 1) {
    const point = tempo_points[index];
    if (!point) continue;
    const next_offset = tempo_points[index + 1]?.offset ?? end_time;
    const segment_start = Math.max(start_time, index === 0 ? start_time : point.offset);
    const segment_end = Math.min(end_time, next_offset);
    if (segment_end > segment_start) {
      const duration = segment_end - segment_start;
      weighted_bpm += (60000 / point.beat_length) * duration;
      weighted_duration += duration;
    }
  }

  let active_point = tempo_points[0];
  for (const point of tempo_points) {
    if (point.offset > start_time) break;
    active_point = point;
  }
  const active_bpm = active_point ? 60000 / active_point.beat_length : 0;
  return {
    bpm_min: Math.min(...bpms),
    bpm_max: Math.max(...bpms),
    bpm_avg: weighted_duration > 0 ? weighted_bpm / weighted_duration : active_bpm,
  };
}

function computeChartStats(source) {
  const timing_points = parseTimingPoints(source);
  const slider_multiplier = readNumber(source, "SliderMultiplier") ?? 1.4;
  let start_time = Infinity;
  let end_time = -Infinity;
  let note_count = 0;
  let long_note_count = 0;

  for (const line of readSection(source, "HitObjects").split(/\r?\n/)) {
    const fields = line.trim().split(",");
    const note_time = Number(fields[2]);
    const type = Number(fields[3]);
    if (!Number.isFinite(note_time) || !Number.isInteger(type)) continue;

    let note_end_time = note_time;
    if ((type & 128) !== 0 || (type & 8) !== 0) {
      const parsed_end_time = Number(fields[5]?.split(":", 1)[0]);
      if (Number.isFinite(parsed_end_time)) note_end_time = parsed_end_time;
    } else if ((type & 2) !== 0) {
      note_end_time = sliderEndTime(note_time, fields, timing_points, slider_multiplier);
    }
    note_count += 1;
    if ((type & 128) !== 0) long_note_count += 1;
    start_time = Math.min(start_time, note_time, note_end_time);
    end_time = Math.max(end_time, note_time, note_end_time);
  }

  if (note_count === 0) start_time = end_time = 0;
  const duration_seconds = Math.max(0, end_time - start_time) / 1000;
  return {
    duration_seconds,
    note_count,
    long_note_ratio: note_count > 0 ? long_note_count / note_count : 0,
    difficulty: duration_seconds > 0 ? note_count / duration_seconds : 0,
    ...computeBpm(timing_points, start_time, end_time),
  };
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

async function directoryExists(directory_path) {
  try {
    return (await stat(directory_path)).isDirectory();
  } catch (reason) {
    if (reason && typeof reason === "object" && "code" in reason && reason.code === "ENOENT") return false;
    throw reason;
  }
}

async function generateBackgroundPreview(source_path, preview_path, ffmpeg_path) {
  try {
    const [source_stat, preview_stat] = await Promise.all([stat(source_path), stat(preview_path)]);
    if (preview_stat.mtimeMs >= source_stat.mtimeMs) return;
  } catch {
    // A missing or unreadable preview is regenerated below.
  }

  const temporary_path = `${preview_path}.tmp.webp`;
  await rm(temporary_path, { force: true });
  try {
    await execFileAsync(ffmpeg_path, [
      "-loglevel", "error",
      "-y",
      "-i", source_path,
      "-frames:v", "1",
      "-vf", "scale=-2:445:flags=fast_bilinear",
      "-c:v", "libwebp",
      "-quality", "30",
      "-compression_level", "2",
      "-map_metadata", "-1",
      temporary_path,
    ]);
    await rename(temporary_path, preview_path);
  } catch (reason) {
    await rm(temporary_path, { force: true });
    throw reason;
  }
}

async function generateAudioPreview(source_path, preview_path, preview_seconds, ffmpeg_path) {
  if (await readableFile(preview_path)) return;

  const temporary_path = `${preview_path}.tmp.webm`;
  await rm(temporary_path, { force: true });
  try {
    await execFileAsync(ffmpeg_path, [
      "-loglevel", "error",
      "-y",
      "-ss", String(preview_seconds),
      "-i", source_path,
      "-t", String(AUDIO_PREVIEW_DURATION_SECONDS),
      "-vn",
      "-map_metadata", "-1",
      "-ac", "1",
      "-ar", "24000",
      "-c:a", "libopus",
      "-b:a", "32k",
      "-vbr", "on",
      "-compression_level", "10",
      "-application", "audio",
      temporary_path,
    ]);
    await rename(temporary_path, preview_path);
  } catch (reason) {
    await rm(temporary_path, { force: true });
    throw reason;
  }
}

async function removeStaleAudioPreviews(directory, referenced_files) {
  for (const file of await readdir(directory)) {
    if (file.endsWith(".webm") && !referenced_files.has(file)) {
      await rm(path.join(directory, file), { force: true });
    }
  }
}

export function parseOsuMetadata(source, folder, chart_file, location = "") {
  const mode = readNumber(source, "Mode");
  const keys = readNumber(source, "CircleSize");
  const audio_file = safeFileName(readProperty(source, "AudioFilename"));
  const background_file = safeFileName(readBackground(source) ?? "");
  const beatmap_id = readNumber(source, "BeatmapID");
  const beatmap_set_id = readNumber(source, "BeatmapSetID");
  const song_id = beatmap_set_id && beatmap_set_id > 0
    ? String(beatmap_set_id)
    : fallbackId("set", path.posix.join(location, folder));
  const chart_id = beatmap_id && beatmap_id > 0
    ? String(beatmap_id)
    : fallbackId("chart", path.posix.join(location, folder, chart_file));

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
    keys: mode === 3 && Number.isInteger(keys) && keys > 0 ? keys : null,
    format: "osu",
    ...computeChartStats(source),
    audio_file,
    background_file,
  };
}

export function gameplayAssetManifest(charts) {
  const assets = [...new Set(charts.flatMap((chart) => [chart.chart_path, chart.audio_path]))]
    .map((asset_path) => asset_path.replace(/^charts\//, ""))
    .sort();
  return assets.length ? `${assets.join("\0")}\0` : "";
}

async function scanCharts(charts_directory, background_previews_directory, audio_previews_directory, ffmpeg_path) {
  const locations = [];
  const songs = new Map();
  const charts = [];
  let skipped = 0;
  const location_names = [];
  for (const entry of await readdir(charts_directory, { withFileTypes: true })) {
    if (entry.isDirectory() || (entry.isSymbolicLink() && await directoryExists(path.join(charts_directory, entry.name)))) {
      location_names.push(entry.name);
    }
  }
  location_names.sort();

  for (const [location_index, location_name] of location_names.entries()) {
    const location_id = location_index + 1;
    const location_directory = path.join(charts_directory, location_name);
    locations.push({
      id: location_id,
      name: path.basename(location_directory),
      path: path.posix.join("charts", location_name),
    });

    const folders = [];
    for (const entry of await readdir(location_directory, { withFileTypes: true })) {
      if (entry.isDirectory() || (entry.isSymbolicLink() && await directoryExists(path.join(location_directory, entry.name)))) {
        folders.push(entry.name);
      }
    }
    folders.sort();

    for (const folder of folders) {
      const folder_path = path.join(location_directory, folder);
      const chart_files = (await readdir(folder_path))
        .filter((file) => file.toLowerCase().endsWith(".osu"))
        .sort();

      for (const chart_file of chart_files) {
        const source = await readFile(path.join(folder_path, chart_file), "utf8");
        const metadata = parseOsuMetadata(source, folder, chart_file, location_name);

        if (!Number.isInteger(metadata.mode) || metadata.mode < 0 || metadata.mode > 3 || !metadata.audio_file) {
          skipped += 1;
          continue;
        }

        const audio_path = path.join(folder_path, metadata.audio_file);
        if (!await readableFile(audio_path)) {
          skipped += 1;
          continue;
        }

        const audio_stat = await stat(audio_path);
        const audio_preview_key = createHash("sha256").update([
          path.posix.join("charts", location_name, folder, metadata.audio_file),
          audio_stat.size,
          audio_stat.mtimeMs,
          metadata.preview_seconds,
          AUDIO_PREVIEW_DURATION_SECONDS,
          AUDIO_PREVIEW_PROFILE,
        ].join("\0")).digest("hex").slice(0, 24);
        const audio_preview_file = `${audio_preview_key}.webm`;
        await generateAudioPreview(
          audio_path,
          path.join(audio_previews_directory, audio_preview_file),
          metadata.preview_seconds,
          ffmpeg_path,
        );

        const background_file = metadata.background_file
          && await readableFile(path.join(folder_path, metadata.background_file))
          ? metadata.background_file
          : null;
        if (!songs.has(metadata.song_id)) {
          songs.set(metadata.song_id, metadata);
        }

        let background_preview_path = null;
        if (background_file) {
          const source_path = path.join(folder_path, background_file);
          const background_path = path.posix.join("charts", location_name, folder, background_file);
          const preview_file = `${createHash("sha256").update(background_path).digest("hex").slice(0, 24)}.webp`;
          await rm(`${source_path}.rizu-preview.webp`, { force: true });
          await generateBackgroundPreview(source_path, path.join(background_previews_directory, preview_file), ffmpeg_path);
          background_preview_path = path.posix.join("chart-previews", preview_file);
        }

        charts.push({
          ...metadata,
          location_id,
          chart_path: path.posix.join("charts", location_name, folder, chart_file),
          audio_path: path.posix.join("charts", location_name, folder, metadata.audio_file),
          audio_preview_path: path.posix.join("audio-previews", audio_preview_file),
          background_path: background_file ? path.posix.join("charts", location_name, folder, background_file) : null,
          background_preview_path,
        });
      }
    }
  }

  return { locations, songs: [...songs.values()], charts, skipped };
}

function writeDatabases(client_path, client_schema, data, generated_at) {
  const version_hash = createHash("sha256");
  version_hash.update(JSON.stringify(data.locations));
  version_hash.update("\0");
  version_hash.update(JSON.stringify(data.songs));
  version_hash.update("\0");
  version_hash.update(JSON.stringify(data.charts));
  const version = version_hash.digest("hex");
  const client_db = new DatabaseSync(client_path);

  try {
    client_db.exec(client_schema);
    client_db.prepare("INSERT INTO catalog VALUES (?, ?, ?)").run(SCHEMA_VERSION, version, generated_at);

    const insert_client_location = client_db.prepare("INSERT INTO locations VALUES (?, ?, ?)");
    const insert_client_song = client_db.prepare("INSERT INTO songs VALUES (?, ?, ?, ?, ?, ?, ?)");
    const insert_client_chart = client_db.prepare("INSERT INTO charts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");

    client_db.exec("BEGIN");
    for (const location of data.locations) {
      insert_client_location.run(location.id, location.name, location.path);
    }
    for (const song of data.songs) {
      insert_client_song.run(song.song_id, song.title, song.title_unicode, song.artist, song.artist_unicode, song.source, song.tags);
    }
    for (const chart of data.charts) {
      const stats = [chart.duration_seconds, chart.note_count, chart.long_note_ratio, chart.bpm_min, chart.bpm_max, chart.bpm_avg, chart.difficulty, chart.format];
      insert_client_chart.run(chart.chart_id, chart.song_id, chart.location_id, chart.name, chart.creator, chart.mode, chart.keys, chart.beatmap_id, ...stats, chart.chart_path, chart.audio_path, chart.preview_seconds, chart.audio_preview_path, chart.background_preview_path);
    }
    client_db.exec("COMMIT");
  } finally {
    client_db.close();
  }

  return version;
}

export async function cacheCharts({
  charts_directory,
  client_database,
  schema_directory,
  background_previews_directory = path.join(path.dirname(charts_directory), "chart-previews"),
  audio_previews_directory = path.join(path.dirname(charts_directory), "audio-previews"),
  ffmpeg_path = "ffmpeg",
}) {
  const client_temp = `${client_database}.tmp`;
  await Promise.all([
    mkdir(background_previews_directory, { recursive: true }),
    mkdir(audio_previews_directory, { recursive: true }),
  ]);
  await rm(client_temp, { force: true });

  try {
    const [data, client_schema] = await Promise.all([
      scanCharts(charts_directory, background_previews_directory, audio_previews_directory, ffmpeg_path),
      readFile(path.join(schema_directory, "client-catalog.sql"), "utf8"),
    ]);
    const generated_at = Math.floor(Date.now() / 1000);
    const version = writeDatabases(client_temp, client_schema, data, generated_at);
    await rename(client_temp, client_database);
    await removeStaleAudioPreviews(
      audio_previews_directory,
      new Set(data.charts.map((chart) => path.basename(chart.audio_preview_path))),
    );
    return { ...data, version };
  } catch (reason) {
    await rm(client_temp, { force: true });
    throw reason;
  }
}
