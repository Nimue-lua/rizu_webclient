import type { ManiaChart, OsuChart } from "../chart/Chart";
import { parseOsuChart } from "../chart/format/osu/OsuParser";
import type { NoteSkin } from "../noteskin/NoteSkin";
import { loadOsuManiaSkinUrl, loadOsuStandardSkinUrl, type OsuStandardSkin } from "../noteskin/osu/OsuSkin";
import { loadNoteSkinOverrides, noteSkinOverrideKey } from "../noteskin/NoteSkinOverrides";

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
  note_skin_id: string;
  title: string;
}

interface GameplayDataBase {
  audio_buffer: AudioBuffer;
  audio_context: AudioContext;
  chart_id: string;
  note_skin_id: string;
}

export interface ManiaGameplayData extends GameplayDataBase {
  mode: "mania";
  chart: ManiaChart;
  note_skin: NoteSkin;
  note_skin_source: {
    readonly hitPosition: number;
    readonly columnStart: number;
    readonly judgePosition: number;
    readonly comboPosition: number;
  };
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
      return { mode: "osu", audio_buffer, audio_context, chart, chart_id: location.chart_id,
        note_skin_id: location.note_skin_id, note_skin };
    }
    const note_skin = await loadOsuManiaSkinUrl(skin_url, chart.column_count, signal);
    const note_skin_source = {
      hitPosition: note_skin.config.hitPosition,
      columnStart: note_skin.config.columnStart,
      judgePosition: note_skin.config.judgePosition,
      comboPosition: note_skin.config.comboPosition,
    };
    const override_key = noteSkinOverrideKey(location.note_skin_id, "mania", chart.column_count);
    const overrides = loadNoteSkinOverrides(override_key).mania;
    note_skin.config.hitPosition = overrides?.hitPosition ?? note_skin_source.hitPosition;
    note_skin.config.columnStart = overrides?.columnStart ?? note_skin_source.columnStart;
    note_skin.config.judgePosition = overrides?.judgePosition ?? note_skin_source.judgePosition;
    note_skin.config.comboPosition = overrides?.comboPosition ?? note_skin_source.comboPosition;
    return { mode: "mania", audio_buffer, audio_context, chart, chart_id: location.chart_id,
      note_skin_id: location.note_skin_id, note_skin, note_skin_source };
  }
}
