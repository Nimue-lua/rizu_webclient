import type { Chart } from "../chart/Chart";
import { parseOsuChart } from "../chart/format/osu/OsuParser";

export interface GameplayLocation {
  audio_url: string;
  artist: string;
  background_url: string | null;
  chart_name: string;
  chart_url: string;
  title: string;
}

export interface GameplayData {
  audio_buffer: AudioBuffer;
  audio_context: AudioContext;
  chart: Chart;
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
    const [audio_data, chart_data] = await Promise.all([
      fetchAsset(location.audio_url, signal),
      fetchAsset(location.chart_url, signal),
    ]);
    const [audio_buffer, chart] = await Promise.all([
      audio_context.decodeAudioData(audio_data),
      Promise.resolve(parseOsuChart(new TextDecoder().decode(chart_data))),
    ]);
    return { audio_buffer, audio_context, chart };
  }
}
