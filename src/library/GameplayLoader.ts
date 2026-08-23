import type { Chart } from "../chart/Chart";
import { parseOsuChart } from "../chart/format/osu/TinyParser";

export interface GameplayLocation {
  audio_url: string;
  chart_url: string;
}

export interface GameplayData {
  audio_buffer: AudioBuffer;
  audio_context: AudioContext;
  chart: Chart;
}

export interface GameplayLoader {
  getLocation(chart_id: string, signal: AbortSignal): Promise<GameplayLocation>;
  load(location: GameplayLocation, audio_context: AudioContext, signal: AbortSignal): Promise<GameplayData>;
}

async function fetchAsset(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  return response.arrayBuffer();
}

export class HttpGameplayLoader implements GameplayLoader {
  async getLocation(chart_id: string, signal: AbortSignal): Promise<GameplayLocation> {
    const response = await fetch(`/api/charts/${encodeURIComponent(chart_id)}`, { signal });
    if (!response.ok) {
      throw new Error(`Failed to load the selected chart: ${response.status} ${response.statusText}`);
    }
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || !("audio_url" in value) || !("chart_url" in value) ||
      typeof value.audio_url !== "string" || typeof value.chart_url !== "string") {
      throw new Error("Selected chart has an invalid asset location");
    }
    return { audio_url: value.audio_url, chart_url: value.chart_url };
  }

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
