import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 11;
const AUDIO_PROFILE = "opus-96k-stereo-v1";
const BACKGROUND_PROFILE = "v2";

function readProperty(source, name) {
  return source.match(new RegExp(`^${name}:\\s*(.*?)\\r?$`, "m"))?.[1]?.trim() ?? "";
}

function readNumber(source, name) {
  const value = Number(readProperty(source, name));
  return Number.isFinite(value) ? value : null;
}

function readOptionalNumber(source, name) {
  const property = readProperty(source, name);
  if (!property) return null;
  const value = Number(property);
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

function computeOsuDifficulty(hit_objects, duration_seconds, circle_size) {
  const objects = hit_objects.filter((object) => !object.spinner);
  if (objects.length === 0) return { difficulty: 0, speed: 0, dexterity: 0, stamina: 0, technical: 0 };

  const speed_strains = [];
  const stamina_strains = [];
  const technical_strains = [];
  const aim_sync_strains = [];
  const first_time = objects[0].time;
  const movement_sections = new Map();
  const aim_sync_sections = new Map();
  let previous_delta = 0;
  let stamina_seconds = 0;
  let spaced_stream_length = 0;
  let tapping_run_length = 0;
  const radius = Math.max(0, 54.4 - 4.48 * (Number.isFinite(circle_size) ? circle_size : 5));
  let previous_direction = null;
  for (let index = 1; index < objects.length; index += 1) {
    const previous = objects[index - 1];
    const object = objects[index];
    const delta = object.time - previous.time;
    if (!(delta > 0)) continue;

    const movement_x = object.x - previous.x;
    const movement_y = object.y - previous.y;
    const center_spacing = Math.hypot(movement_x, movement_y);
    const spacing = Math.max(0, center_spacing - radius * 2);
    let right_angle = 0;
    let reversal = 0;
    if (spacing > 0 && previous_direction) {
      const cosine = Math.max(-1, Math.min(1,
        (previous_direction.x * movement_x + previous_direction.y * movement_y) / center_spacing));
      const angle = Math.acos(cosine);
      right_angle = Math.max(0, 1 - Math.abs(angle - Math.PI / 2) / (Math.PI / 2));
      reversal = Math.max(0, (angle - Math.PI * 0.75) / (Math.PI * 0.25));
    }
    if (spacing > 0) previous_direction = { x: movement_x / center_spacing, y: movement_y / center_spacing };
    const awkwardness = 1 + right_angle * 0.2 + reversal * 0.4;
    const turn_difficulty = right_angle * 1.5 + reversal * 2;
    const speed = 200 / Math.max(delta, 50);
    const rhythm = previous_delta > 0
      ? Math.min(Math.abs(Math.log2(delta / previous_delta)), 2) * 1.2
      : 0;
    const jump = Math.min((spacing / 150) * speed * 1.2, 5);
    const angle_technical = Math.min((spacing / 150) * speed * turn_difficulty, 3);
    if (delta <= 500) {
      const section = Math.floor((object.time - first_time) / 500);
      movement_sections.set(section, (movement_sections.get(section) ?? 0) + spacing * awkwardness * 2);
    }
    const stream = delta <= 200 && center_spacing <= 140
      ? speed * 0.75 * (1 + Math.min(center_spacing / 120, 1) * 0.6)
      : 0;
    if (delta >= 30_000) stamina_seconds = 0;
    else if (delta > 200) stamina_seconds *= 10 ** (-delta / 5000);
    if (stream > 0) stamina_seconds = Math.min(120, stamina_seconds + delta / 1000);
    const stamina = stream > 0 ? Math.sqrt(Math.min(stamina_seconds, 10) / 10) * stream * 1.5 : 0;
    if (delta <= 150) {
      tapping_run_length = Math.min(24, tapping_run_length + 1);
      const tapping_rate = Math.max(0, 150 / Math.max(delta, 50) - 1);
      const sustained_bonus = 0.35 + 0.65 * Math.sqrt(tapping_run_length / 24);
      speed_strains.push(tapping_rate * 2.6 * sustained_bonus);
    } else {
      tapping_run_length = 0;
    }
    spaced_stream_length = delta > 120
      ? 0
      : spacing > 0
        ? Math.min(12, spaced_stream_length + 1)
        : Math.max(0, spaced_stream_length - 1);
    const aim_sync = jump * Math.min(spaced_stream_length / 12, 1) * 2.8;
    if (aim_sync > 0) {
      aim_sync_strains.push(aim_sync);
      const section = Math.floor((object.time - first_time) / 500);
      aim_sync_sections.set(section, (aim_sync_sections.get(section) ?? 0) + aim_sync);
    }
    if (stamina > 0) stamina_strains.push(stamina);
    const transition_technical = rhythm * Math.sqrt(speed) + angle_technical + aim_sync;
    if (transition_technical > 0) technical_strains.push(transition_technical);
    previous_delta = delta;
  }

  for (const object of objects) {
    if (!Number.isFinite(object.slider_length)) continue;
    const slider_length = Math.max(0, object.slider_length);
    const slider_speed = object.slider_span_duration > 0
      ? Math.max(0, slider_length - radius * 3) / object.slider_span_duration
      : 0;
    const slider_technical = slider_speed
      * (1.2 + Math.min(Math.sqrt(slider_length / 100) * 0.35, 1.5))
      * (1 + Math.max(0, object.slider_repeats - 1) * 0.25);
    if (slider_technical > 0) technical_strains.push(slider_technical);
  }

  const length_multiplier = duration_seconds < 35 ? 0.8 : duration_seconds < 60 ? 0.85 : duration_seconds < 120 ? 0.95 : 1;
  const hardest_average = (values) => {
    if (values.length === 0) return 0;
    values.sort((left, right) => right - left);
    const hardest_count = Math.max(1, Math.ceil(values.length * 0.2));
    return values.slice(0, hardest_count).reduce((sum, strain) => sum + strain, 0) / hardest_count;
  };
  const scale_skill = (strain) => strain <= 10
    ? strain ** 1.8
    : 10 ** 1.8 + (strain - 10) * 2;
  const movement_peak = (window) => {
    let maximum = 0;
    for (const index of movement_sections.keys()) {
      let sum = 0;
      for (let offset = 0; offset < window; offset += 1) sum += movement_sections.get(index - offset) ?? 0;
      maximum = Math.max(maximum, sum / window);
    }
    return maximum;
  };
  const movement_peak_strain = (movement_peak(4) * 0.35 + movement_peak(10) * 0.45 + movement_peak(20) * 0.2) / 1000;
  const movement_load = [...movement_sections.values()].reduce((sum, rate) => sum + Math.max(0, rate - 800) / 1000, 0);
  const aim_sync_load = [...aim_sync_sections.values()].reduce((sum, strain) => sum + Math.max(0, strain - 4) / 4, 0);
  const speed = scale_skill(hardest_average(speed_strains) * length_multiplier);
  const dexterity = scale_skill((movement_peak_strain + Math.sqrt(movement_load) * 0.05) * 1.7 * length_multiplier);
  const stamina = scale_skill(hardest_average(stamina_strains) * length_multiplier);
  const technical_strain = Math.max(hardest_average(technical_strains), hardest_average(aim_sync_strains))
    + Math.sqrt(aim_sync_load) * 0.2;
  const technical = scale_skill(technical_strain * length_multiplier);
  const difficulty = Math.hypot(speed, dexterity, stamina, technical);
  return { difficulty, speed, dexterity, stamina, technical };
}

function computeManiaDifficulty(hit_objects, column_count, duration_seconds) {
  const events = hit_objects.flatMap((object) => object.hold
    ? [{ time: object.time, kind: "hold_start" }, { time: object.end_time, kind: "hold_end" }]
    : [{ time: object.time, kind: "regular" }])
    .sort((left, right) => left.time - right.time);
  if (events.length === 0) return 0;

  const groups = [];
  for (const event of events) {
    const group = groups.at(-1);
    if (group?.time === event.time) {
      group.actions += 1;
      group.regular_notes += event.kind === "regular" ? 1 : 0;
      group.hold_starts += event.kind === "hold_start" ? 1 : 0;
      group.hold_ends += event.kind === "hold_end" ? 1 : 0;
      group.hold_change = group.hold_starts - group.hold_ends;
    } else {
      groups.push({
        time: event.time,
        actions: 1,
        regular_notes: event.kind === "regular" ? 1 : 0,
        hold_starts: event.kind === "hold_start" ? 1 : 0,
        hold_ends: event.kind === "hold_end" ? 1 : 0,
        hold_change: event.kind === "hold_start" ? 1 : event.kind === "hold_end" ? -1 : 0,
      });
    }
  }

  const strains = [];
  let active_holds = 0;
  let previous_delta = 0;
  let stamina_seconds = 0;
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const delta = index > 0 ? group.time - groups[index - 1].time : 0;
    active_holds = Math.max(0, active_holds + group.hold_change);
    const chord = Math.max(0, group.actions - 1) * 0.45;
    if (!(delta > 0)) {
      strains.push(chord);
      continue;
    }

    const speed = 200 / Math.max(delta, 30);
    const rhythm = previous_delta > 0
      ? Math.min(Math.abs(Math.log2(delta / previous_delta)), 2) * 1.2
      : 0;
    const action_weight = Math.min(1,
      group.regular_notes + group.hold_starts * 0.7 + group.hold_ends * 0.25);
    const stream = delta <= 200 ? speed * action_weight * (1 + chord * 0.35) : 0;
    const regular_note_bonus = delta <= 200 && group.regular_notes > 0 ? speed * 0.6 : 0;
    if (delta >= 30_000) stamina_seconds = 0;
    else if (delta > 200) stamina_seconds *= 10 ** (-delta / 5000);
    if (stream > 0) stamina_seconds = Math.min(120, stamina_seconds + delta / 1000);
    const stamina = stream > 0 ? Math.sqrt(stamina_seconds / 120) * stream * 0.75 : 0;
    const hold_pressure = stream * Math.min(active_holds / Math.max(column_count, 1), 1) * 0.25;
    strains.push(rhythm + chord + stream + regular_note_bonus + stamina + hold_pressure);
    previous_delta = delta;
  }

  const length_multiplier = duration_seconds < 35 ? 0.8 : duration_seconds < 60 ? 0.85 : duration_seconds < 120 ? 0.95 : 1;
  strains.sort((left, right) => right - left);
  const hardest_count = Math.max(1, Math.ceil(strains.length * 0.2));
  return (0.5 + strains.slice(0, hardest_count)
    .reduce((sum, strain) => sum + strain, 0) / hardest_count) * length_multiplier;
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
  const mode = readNumber(source, "Mode") ?? 0;
  const hit_objects = [];
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
    hit_objects.push({
      x: Number(fields[0]) || 0,
      y: Number(fields[1]) || 0,
      time: note_time,
      end_time: note_end_time,
      hold: (type & 128) !== 0,
      spinner: (type & 8) !== 0,
      slider_length: (type & 2) !== 0 ? Number(fields[7]) : null,
      slider_repeats: (type & 2) !== 0 ? Number(fields[6]) : 0,
      slider_span_duration: (type & 2) !== 0 && Number(fields[6]) > 0
        ? (note_end_time - note_time) / Number(fields[6])
        : 0,
    });
    note_count += 1;
    if ((type & 128) !== 0) long_note_count += 1;
    start_time = Math.min(start_time, note_time, note_end_time);
    end_time = Math.max(end_time, note_time, note_end_time);
  }

  if (note_count === 0) start_time = end_time = 0;
  const duration_seconds = Math.max(0, end_time - start_time) / 1000;
  const osu_difficulty = mode === 0
    ? computeOsuDifficulty(hit_objects, duration_seconds, readOptionalNumber(source, "CircleSize") ?? 5)
    : null;
  return {
    duration_seconds,
    note_count,
    long_note_ratio: note_count > 0 ? long_note_count / note_count : 0,
    difficulty: osu_difficulty
      ? osu_difficulty.difficulty
      : mode === 3
        ? computeManiaDifficulty(hit_objects, readNumber(source, "CircleSize") ?? 4, duration_seconds)
        : duration_seconds > 0 ? note_count / duration_seconds : 0,
    speed: osu_difficulty?.speed ?? null,
    dexterity: osu_difficulty?.dexterity ?? null,
    stamina: osu_difficulty?.stamina ?? null,
    technical: osu_difficulty?.technical ?? null,
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

async function immutableFileExists(file_path) {
  try {
    return (await stat(file_path)).isFile();
  } catch {
    return false;
  }
}

async function runFfmpeg(ffmpeg_path, arguments_, temporary_path, output_path) {
  if (await immutableFileExists(output_path)) return;
  await rm(temporary_path, { force: true });
  try {
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn(ffmpeg_path, ["-loglevel", "error", "-y", ...arguments_, temporary_path], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      ffmpeg.stderr.setEncoding("utf8");
      ffmpeg.stderr.on("data", (chunk) => { stderr += chunk; });
      ffmpeg.on("error", reject);
      ffmpeg.on("close", (code) => code === 0
        ? resolve()
        : reject(new Error(`FFmpeg exited with code ${code}: ${stderr.trim()}`)));
    });
    await rename(temporary_path, output_path);
  } catch (reason) {
    await rm(temporary_path, { force: true });
    throw reason;
  }
}

async function generateBackgroundPreview(source_path, preview_path, ffmpeg_path) {
  await runFfmpeg(ffmpeg_path, [
    "-i", source_path,
    "-frames:v", "1",
    "-vf", "scale=-2:800:flags=lanczos",
    "-c:v", "libaom-av1",
    "-still-picture", "1",
    "-crf", "36",
    "-cpu-used", "6",
    "-pix_fmt", "yuv420p",
    "-map_metadata", "-1",
  ], `${preview_path}.tmp.avif`, preview_path);
}

async function generateAudio(source_path, output_path, ffmpeg_path, preview_seconds = null) {
  const seek = preview_seconds === null ? [] : ["-ss", String(preview_seconds), "-t", "20"];
  await runFfmpeg(ffmpeg_path, [
    "-i", source_path,
    ...seek,
    "-map_metadata", "-1",
    "-vn",
    "-c:a", "libopus",
    "-b:a", "96k",
    "-vbr", "on",
    "-compression_level", "10",
    "-application", "audio",
    "-ar", "48000",
    "-ac", "2",
  ], `${output_path}.tmp.webm`, output_path);
}

export function parseOsuMetadata(source, folder, chart_file, location = "") {
  const mode = readNumber(source, "Mode");
  const circle_size = readOptionalNumber(source, "CircleSize");
  const overall_difficulty = readOptionalNumber(source, "OverallDifficulty") ?? 5;
  const approach_rate = readOptionalNumber(source, "ApproachRate") ?? overall_difficulty;
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
    keys: mode === 3 && Number.isInteger(circle_size) && circle_size > 0 ? circle_size : null,
    circle_size,
    approach_rate,
    overall_difficulty,
    format: "osu",
    ...computeChartStats(source),
    audio_file,
    background_file,
  };
}

export function gameplayAssetManifest(charts) {
  const assets = [...new Set(charts.flatMap((chart) => [
    chart.chart_path,
    chart.audio_path,
    chart.audio_preview_path,
    chart.background_preview_path,
  ]).filter(Boolean))].sort();
  return assets.length ? `${assets.join("\0")}\0` : "";
}

async function scanCharts({
  charts_directory,
  chart_assets_directory,
  audio_directory,
  audio_previews_directory,
  background_previews_directory,
  ffmpeg_path,
  generate_previews,
  asset_prefix,
}) {
  const locations = [];
  const songs = new Map();
  const charts = [];
  const chart_ids = new Set();
  const audio_assets = new Map();
  let skipped = 0;
  const location_names = [];
  for (const entry of await readdir(charts_directory, { withFileTypes: true })) {
    if (entry.name === "chart-previews") continue;
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
      path: path.posix.join(asset_prefix, location_name),
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
        const chart_source_path = path.join(folder_path, chart_file);
        const chart_bytes = await readFile(chart_source_path);
        const source = chart_bytes.toString("utf8");
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

        const background_file = metadata.background_file
          && await readableFile(path.join(folder_path, metadata.background_file))
          ? metadata.background_file
          : null;
        if (!songs.has(metadata.song_id)) {
          songs.set(metadata.song_id, metadata);
        }

        const chart_md5 = createHash("md5").update(chart_bytes).digest("hex");
        const chart_asset_path = path.join(chart_assets_directory, `${chart_md5}.osu`);
        if (generate_previews && !await immutableFileExists(chart_asset_path)) {
          await copyFile(chart_source_path, chart_asset_path);
        }

        const audio_bytes = await readFile(audio_path);
        const audio_hash = createHash("sha256").update(audio_bytes).digest("hex");
        const encoded_audio_name = `${audio_hash}-${AUDIO_PROFILE}.webm`;
        const encoded_audio_path = path.join(audio_directory, encoded_audio_name);
        let audio_asset = audio_assets.get(audio_hash);
        if (!audio_asset) {
          const preview_start = metadata.preview_seconds > 0
            ? metadata.preview_seconds
            : metadata.duration_seconds * 0.4;
          const preview_key = createHash("sha256")
            .update(audio_hash)
            .update("\0")
            .update(String(preview_start))
            .update("\0")
            .update(AUDIO_PROFILE)
            .digest("hex");
          audio_asset = { preview_start, preview_name: `${preview_key}.webm` };
          audio_assets.set(audio_hash, audio_asset);
        }
        if (generate_previews && audio_asset.preview_start === (metadata.preview_seconds > 0 ? metadata.preview_seconds : metadata.duration_seconds * 0.4)) {
          await generateAudio(audio_path, encoded_audio_path, ffmpeg_path);
          await generateAudio(audio_path, path.join(audio_previews_directory, audio_asset.preview_name), ffmpeg_path, audio_asset.preview_start);
        }

        let background_preview_path = null;
        if (background_file) {
          const source_path = path.join(folder_path, background_file);
          const background_md5 = createHash("md5").update(await readFile(source_path)).digest("hex");
          const preview_file = `${background_md5}.avif`;
          if (generate_previews) {
            await rm(`${source_path}.rizu-preview.webp`, { force: true });
            await generateBackgroundPreview(source_path, path.join(background_previews_directory, preview_file), ffmpeg_path);
          }
          background_preview_path = path.posix.join("backgrounds", BACKGROUND_PROFILE, preview_file);
        }

        if (chart_ids.has(metadata.chart_id)) {
          metadata.chart_id = fallbackId("chart", path.posix.join(location_name, folder, chart_file));
        }
        chart_ids.add(metadata.chart_id);

        charts.push({
          ...metadata,
          location_id,
          chart_md5,
          chart_index: 1,
          chart_path: path.posix.join("chart-files", "v1", `${chart_md5}.osu`),
          audio_path: path.posix.join("audio", "v1", encoded_audio_name),
          audio_preview_path: path.posix.join("audio-previews", "v1", audio_asset.preview_name),
          background_path: null,
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
    const insert_client_chart = client_db.prepare(`
      INSERT INTO charts (
        id, song_id, location_id, name, creator, mode, keys, beatmap_id,
        duration_seconds, note_count, long_note_ratio, bpm_min, bpm_max, bpm_avg, difficulty,
        circle_size, approach_rate, overall_difficulty, speed, dexterity, stamina, technical,
        format, chart_path, audio_path, audio_preview_path,
        preview_seconds, background_preview_path, chart_md5, chart_index
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    client_db.exec("BEGIN");
    for (const location of data.locations) {
      insert_client_location.run(location.id, location.name, location.path);
    }
    for (const song of data.songs) {
      insert_client_song.run(song.song_id, song.title, song.title_unicode, song.artist, song.artist_unicode, song.source, song.tags);
    }
    for (const chart of data.charts) {
      const stats = [chart.duration_seconds, chart.note_count, chart.long_note_ratio, chart.bpm_min, chart.bpm_max, chart.bpm_avg, chart.difficulty,
        chart.circle_size, chart.approach_rate, chart.overall_difficulty,
        chart.speed ?? null, chart.dexterity ?? null, chart.stamina ?? null, chart.technical ?? null, chart.format];
      insert_client_chart.run(chart.chart_id, chart.song_id, chart.location_id, chart.name, chart.creator, chart.mode, chart.keys, chart.beatmap_id, ...stats,
        chart.chart_path, chart.audio_path, chart.audio_preview_path, chart.preview_seconds, chart.background_preview_path, chart.chart_md5, chart.chart_index);
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
  background_previews_directory = path.join(path.dirname(charts_directory), "backgrounds", BACKGROUND_PROFILE),
  chart_assets_directory = path.join(path.dirname(charts_directory), "chart-files", "v1"),
  audio_directory = path.join(path.dirname(charts_directory), "audio", "v1"),
  audio_previews_directory = path.join(path.dirname(charts_directory), "audio-previews", "v1"),
  ffmpeg_path = "ffmpeg",
  asset_prefix = "charts",
  generate_previews = true,
  write_database = true,
}) {
  const client_temp = `${client_database}.tmp`;
  if (generate_previews) {
    await Promise.all([
      mkdir(background_previews_directory, { recursive: true }),
      mkdir(chart_assets_directory, { recursive: true }),
      mkdir(audio_directory, { recursive: true }),
      mkdir(audio_previews_directory, { recursive: true }),
    ]);
  }
  if (write_database) await rm(client_temp, { force: true });

  try {
    const data = await scanCharts({ charts_directory, chart_assets_directory, audio_directory,
      audio_previews_directory, background_previews_directory, ffmpeg_path, generate_previews, asset_prefix });
    let version = null;
    if (write_database) {
      const client_schema = await readFile(path.join(schema_directory, "client-catalog.sql"), "utf8");
      const generated_at = Math.floor(Date.now() / 1000);
      version = writeDatabases(client_temp, client_schema, data, generated_at);
      await rename(client_temp, client_database);
      const gzip_temp = `${client_database}.gz.tmp`;
      await writeFile(gzip_temp, gzipSync(await readFile(client_database), { level: 9 }));
      await rename(gzip_temp, `${client_database}.gz`);
    }
    return { ...data, version };
  } catch (reason) {
    if (write_database) await rm(client_temp, { force: true });
    throw reason;
  }
}
