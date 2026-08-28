import type { ManiaChart, OsuChart } from "../chart/Chart";
import { parseOsuChart } from "../chart/format/osu/OsuParser";
import type { NoteSkin } from "../noteskin/NoteSkin";
import { loadOsuManiaSkinUrl, loadOsuStandardSkinUrl, type OsuStandardSkin } from "../noteskin/osu/OsuSkin";

export interface GameplayLocation {
  chart_id: string;
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

interface GameplayDataBase {
  audio_buffer: AudioBuffer;
  audio_context: AudioContext;
  chart_id: string;
}

export interface ManiaGameplayData extends GameplayDataBase {
  mode: "mania";
  chart: ManiaChart;
  note_skin: NoteSkin;
}

export interface OsuGameplayData extends GameplayDataBase {
  mode: "osu";
  chart: OsuChart;
  note_skin: OsuStandardSkin;
}

export type GameplayData = ManiaGameplayData | OsuGameplayData;

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
    const skin_url = location.note_skin_url;
    if (!skin_url) throw new Error("No note skin is selected for this key mode");
    const [audio_data, chart_source] = await Promise.all([
      fetchAsset(location.audio_url, signal),
      fetchChart(location.chart_url, signal),
    ]);
    const [audio_buffer, chart] = await Promise.all([
      audio_context.decodeAudioData(audio_data),
      Promise.resolve(parseOsuChart(chart_source)),
    ]);
    if (chart.mode === "osu") {
      const note_skin = await loadOsuStandardSkinUrl(skin_url, audio_context, signal);
      return { mode: "osu", audio_buffer, audio_context, chart, chart_id: location.chart_id, note_skin };
    }
    const note_skin = await loadOsuManiaSkinUrl(skin_url, chart.column_count, signal);
    return { mode: "mania", audio_buffer, audio_context, chart, chart_id: location.chart_id, note_skin };
  }
}
