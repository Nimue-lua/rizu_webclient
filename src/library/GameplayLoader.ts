import type { Chart } from "../chart/Chart";
import { parseOsuChart } from "../chart/format/osu/OsuParser";
import { loadNoteSkinZip, type NoteSkin } from "../gameplay/renderer/NoteSkin";

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
  note_skin?: NoteSkin;
}

export interface GameplayLoader {
  load(location: GameplayLocation, audio_context: AudioContext, signal: AbortSignal): Promise<GameplayData>;
}

async function fetchAsset(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  return response.arrayBuffer();
}

export class HttpGameplayLoader implements GameplayLoader {
  async load(location: GameplayLocation, audio_context: AudioContext, signal: AbortSignal): Promise<GameplayData> {
    const [audio_data, chart_data, bundled_skin] = await Promise.all([
      fetchAsset(location.audio_url, signal),
      fetchAsset(location.chart_url, signal),
      location.note_skin_url ? loadNoteSkinZip(location.note_skin_url, signal).catch((error: unknown) => {
        console.warn("Could not load bundled note skin; using fallback", error);
        return undefined;
      }) : Promise.resolve(undefined),
    ]);
    const [audio_buffer, chart] = await Promise.all([
      audio_context.decodeAudioData(audio_data),
      Promise.resolve(parseOsuChart(new TextDecoder().decode(chart_data))),
    ]);
    const note_skin = bundled_skin?.config.mode === "mania" && bundled_skin.config.columnCount === chart.column_count
      ? bundled_skin
      : undefined;
    if (bundled_skin && !note_skin) bundled_skin.image.close();
    return { audio_buffer, audio_context, chart, note_skin };
  }
}
