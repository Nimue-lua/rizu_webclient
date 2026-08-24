import type { Chart } from "../chart/Chart";
import { parseOsuChart } from "../chart/format/osu/OsuParser";
import { loadNoteSkinZip, type NoteSkin } from "../gameplay/renderer/NoteSkin";
import { note_skin_options } from "../gameplay/renderer/NoteSkinSelection";

const DEFAULT_NOTE_SKIN_URL = note_skin_options[0]!.url;

export interface GameplayLocation {
  audio_url: string;
  artist: string;
  background_url: string | null;
  bpm: number;
  chart_name: string;
  chart_url: string;
  difficulty: number;
  duration_seconds: number;
  long_note_ratio: number;
  note_skin_url: string | null;
  title: string;
}

export interface GameplayData {
  audio_buffer: AudioBuffer;
  audio_context: AudioContext;
  chart: Chart;
  note_skin: NoteSkin;
}

export interface GameplayLoader {
  load(location: GameplayLocation, audio_context: AudioContext, signal: AbortSignal): Promise<GameplayData>;
}

async function fetchAsset(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  return response.arrayBuffer();
}

async function fetchChart(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  const source = await response.text();
  if (!source.trimStart().startsWith("osu file format v")) {
    throw new Error(`Failed to fetch chart data from ${url}`);
  }
  return source;
}

export class HttpGameplayLoader implements GameplayLoader {
  async load(location: GameplayLocation, audio_context: AudioContext, signal: AbortSignal): Promise<GameplayData> {
    const skin_url = location.note_skin_url ?? DEFAULT_NOTE_SKIN_URL;
    const [audio_data, chart_source] = await Promise.all([
      fetchAsset(location.audio_url, signal),
      fetchChart(location.chart_url, signal),
    ]);
    const [audio_buffer, chart] = await Promise.all([
      audio_context.decodeAudioData(audio_data),
      Promise.resolve(parseOsuChart(chart_source)),
    ]);
    const loaded_skin = await loadNoteSkinZip(skin_url, chart.column_count, signal).catch((error: unknown) => {
      if (skin_url === DEFAULT_NOTE_SKIN_URL) throw error;
      console.warn("Could not load selected note skin; using default", error);
      return undefined;
    });
    let note_skin = loaded_skin;
    if (note_skin?.config.mode !== "mania") {
      note_skin?.image.close();
      note_skin = undefined;
    }
    if (!note_skin) note_skin = await loadNoteSkinZip(DEFAULT_NOTE_SKIN_URL, chart.column_count, signal);
    return { audio_buffer, audio_context, chart, note_skin };
  }
}
