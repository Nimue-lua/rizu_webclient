import { parseOsuChart, type OsuChart } from "../chart/format/osu/TinyParser";

export interface GameplayAssetReference {
  audio_url: string;
  chart_url: string;
}

export interface LoadedGameplayAssets {
  audio_buffer: AudioBuffer;
  audio_context: AudioContext;
  chart: OsuChart;
}

export interface GameplayAssetProvider {
  load(
    reference: GameplayAssetReference,
    audio_context: AudioContext,
    signal: AbortSignal,
  ): Promise<LoadedGameplayAssets>;
}

async function fetchAsset(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.arrayBuffer();
}

export class HttpGameplayAssetProvider implements GameplayAssetProvider {
  async load(
    reference: GameplayAssetReference,
    audio_context: AudioContext,
    signal: AbortSignal,
  ): Promise<LoadedGameplayAssets> {
    const [audio_data, chart_data] = await Promise.all([
      fetchAsset(reference.audio_url, signal),
      fetchAsset(reference.chart_url, signal),
    ]);
    const [audio_buffer, chart] = await Promise.all([
      audio_context.decodeAudioData(audio_data),
      Promise.resolve(parseOsuChart(new TextDecoder().decode(chart_data))),
    ]);

    return {
      audio_buffer,
      audio_context,
      chart,
    };
  }
}
