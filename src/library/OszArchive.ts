import { unzipSync } from "fflate";
import { parseOsuChart } from "../chart/format/osu/OsuParser";
import type { ChartfileSetView, Chartview } from "./views";

export interface OszArchive {
  readonly file_name: string;
  readonly song: ChartfileSetView;
  dispose(): void;
}

function property(source: string, name: string): string {
  return source.match(new RegExp(`^${name}:\\s*(.*?)\\r?$`, "m"))?.[1]?.trim() ?? "";
}

function backgroundFile(source: string): string | null {
  const events = source.match(/^\[Events\][^\S\r\n]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1] ?? "";
  return events.match(/^(?:0|Background),0,"([^"]+)"/m)?.[1] ?? null;
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function resolvePath(chart_path: string, asset_path: string): string {
  const separator = chart_path.lastIndexOf("/");
  const directory = separator < 0 ? "" : chart_path.slice(0, separator + 1);
  return normalizePath(directory + asset_path);
}

function mimeType(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return ({
    jpeg: "image/jpeg", jpg: "image/jpeg", mp3: "audio/mpeg", ogg: "audio/ogg",
    png: "image/png", wav: "audio/wav", webm: "audio/webm",
  } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}

function blobUrl(bytes: Uint8Array, path: string, urls: string[]): string {
  const data = bytes.slice().buffer;
  const url = URL.createObjectURL(new Blob([data], { type: mimeType(path) }));
  urls.push(url);
  return url;
}

export async function readOszArchive(file: File): Promise<OszArchive> {
  if (!file.name.toLowerCase().endsWith(".osz")) throw new Error("Drop an .osz beatmap archive");

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error("The .osz archive could not be opened");
  }

  const normalized_files = new Map(Object.entries(files).map(([path, bytes]) => [normalizePath(path), bytes]));
  const paths = new Map([...normalized_files.keys()].map((path) => [path.toLowerCase(), path]));
  const sources = [...normalized_files.keys()]
    .filter((path) => path.toLowerCase().endsWith(".osu"))
    .sort((left, right) => left.localeCompare(right))
    .map((path) => ({ path, source: new TextDecoder().decode(normalized_files.get(path)) }));
  if (sources.length === 0) throw new Error("This archive does not contain any .osu charts");

  const urls: string[] = [];
  const asset_urls = new Map<string, string>();
  const charts: Chartview[] = [];
  let title = property(sources[0]!.source, "TitleUnicode") || property(sources[0]!.source, "Title") || file.name.replace(/\.osz$/i, "");
  let artist = property(sources[0]!.source, "ArtistUnicode") || property(sources[0]!.source, "Artist") || "Unknown Artist";

  try {
    for (const { path, source } of sources) {
      let parsed;
      try {
        parsed = parseOsuChart(source);
      } catch (reason) {
        if (reason instanceof Error && reason.message.startsWith("Unsupported osu mode:")) continue;
        throw reason;
      }

      const audio_name = property(source, "AudioFilename");
      const audio_path = paths.get(resolvePath(path, audio_name).toLowerCase());
      const audio_bytes = audio_path ? normalized_files.get(audio_path) : undefined;
      if (!audio_name || !audio_path || !audio_bytes) continue;
      const background_name = backgroundFile(source);
      const background_path = background_name ? paths.get(resolvePath(path, background_name).toLowerCase()) : undefined;
      const chart_title = property(source, "TitleUnicode") || property(source, "Title");
      const chart_artist = property(source, "ArtistUnicode") || property(source, "Artist");
      if (chart_title) title = chart_title;
      if (chart_artist) artist = chart_artist;

      const note_count = parsed.mode === "osu" ? parsed.object_count : parsed.notes.filter((note) => note.weight >= 0).length;
      const long_note_count = parsed.mode === "mania" ? parsed.notes.filter((note) => note.weight === 1).length : 0;
      const first_time = parsed.mode === "osu"
        ? parsed.hit_objects[0]?.absolute_time ?? 0
        : parsed.notes[0]?.absolute_time ?? 0;
      const last_time = parsed.mode === "osu"
        ? parsed.end_time
        : parsed.notes.at(-1)?.absolute_time ?? first_time;
      const duration_seconds = Math.max(0, last_time - first_time);
      const chart_url = blobUrl(new TextEncoder().encode(source), path, urls);
      let audio_url = asset_urls.get(audio_path);
      if (!audio_url) {
        audio_url = blobUrl(audio_bytes, audio_path, urls);
        asset_urls.set(audio_path, audio_url);
      }
      const background_bytes = background_path ? normalized_files.get(background_path) : undefined;
      let background_url = background_path ? asset_urls.get(background_path) ?? null : null;
      if (background_path && background_bytes && !background_url) {
        background_url = blobUrl(background_bytes, background_path, urls);
        asset_urls.set(background_path, background_url);
      }
      background_url = background_path && background_bytes
        ? background_url
        : null;

      charts.push({
        audio_url,
        audio_preview_url: audio_url,
        background_url,
        bpm_avg: parsed.primary_tempo,
        bpm_max: parsed.primary_tempo,
        bpm_min: parsed.primary_tempo,
        chart_url,
        creator: property(source, "Creator") || "Unknown Creator",
        difficulty: duration_seconds > 0 ? note_count / duration_seconds : 0,
        duration_seconds,
        format: "osu",
        id: path,
        keys: parsed.mode === "mania" ? parsed.column_count : null,
        location_id: 0,
        long_note_ratio: note_count > 0 ? long_note_count / note_count : 0,
        mode: parsed.mode === "mania" ? 3 : 0,
        name: property(source, "Version") || path.split("/").at(-1)!.replace(/\.osu$/i, ""),
        note_count,
      });
    }
  } catch (reason) {
    for (const url of urls) URL.revokeObjectURL(url);
    throw reason;
  }

  if (charts.length === 0) {
    for (const url of urls) URL.revokeObjectURL(url);
    throw new Error("This archive has no playable osu! or osu!mania charts with audio");
  }
  charts.sort((left, right) => left.difficulty - right.difficulty || left.name.localeCompare(right.name));

  return {
    file_name: file.name,
    song: { artist, charts, id: `osz:${file.name}`, title },
    dispose: () => {
      for (const url of urls) URL.revokeObjectURL(url);
    },
  };
}
