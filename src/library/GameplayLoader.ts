import type { ManiaChart, OsuChart } from "../chart/Chart";
import { parseOsuChart } from "../chart/format/osu/OsuParser";
import type { NoteSkin } from "../noteskin/NoteSkin";
import { loadOsuManiaSkinUrl, loadOsuStandardSkinUrl, type OsuStandardSkin } from "../noteskin/osu/OsuSkin";
import { loadNoteSkinOverrides, noteSkinOverrideKey } from "../noteskin/NoteSkinOverrides";
import { readLocalAsset, readLocalChart } from "./LocalLibraryStore";
import { downloadArrayBuffer, type DownloadProgress } from "../download/Download";

export interface GameplayLocation {
  chart_id: string;
  chart_md5: string;
  chart_index: number;
  audio_url: string;
  artist: string;
  background_url: string | null;
  bpm: number;
  chart_name: string;
  chart_url: string;
  difficulty: number;
  duration_seconds: number;
  keys: number | null;
  long_note_ratio: number;
  mode: number;
  note_skin_url: string | null;
  note_skin_id: string;
  title: string;
  source_id?: string;
  source_type?: "local" | "remote";
  audio_path?: string;
  background_path?: string;
  chart_path?: string;
}

interface GameplayDataBase {
  audio_buffer: AudioBuffer;
  audio_context: AudioContext;
  chart_id: string;
  chart_md5: string;
  chart_index: number;
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

export interface GameplayLoadProgress extends DownloadProgress {
  readonly id: "audio" | "chart" | "skin";
  readonly label: string;
}

export type GameplayProgressCallback = (progress: GameplayLoadProgress) => void;

export interface GameplayLoader {
  loadAudio(location: GameplayLocation, audio_context: AudioContext, signal: AbortSignal,
    onProgress?: (progress: DownloadProgress) => void): Promise<AudioBuffer>;
  load(location: GameplayLocation, audio_context: AudioContext, signal: AbortSignal,
    onProgress?: GameplayProgressCallback, audio_buffer?: AudioBuffer): Promise<GameplayData>;
}

async function fetchAsset(url: string, signal: AbortSignal,
  onProgress?: (progress: DownloadProgress) => void): Promise<ArrayBuffer> {
  return downloadArrayBuffer(url, { signal }, onProgress);
}

async function fetchChart(url: string, signal: AbortSignal,
  onProgress?: (progress: DownloadProgress) => void): Promise<string> {
  const source = new TextDecoder().decode(await downloadArrayBuffer(url, { signal }, onProgress));
  if (!source.trimStart().startsWith("osu file format v")) {
    throw new Error(`Failed to fetch chart data from ${url}`);
  }
  return source;
}

export class HttpGameplayLoader implements GameplayLoader {
  async loadAudio(location: GameplayLocation, audio_context: AudioContext, signal: AbortSignal,
    onProgress?: (progress: DownloadProgress) => void): Promise<AudioBuffer> {
    const audio_data = location.source_id && location.audio_path
      ? await readLocalAsset(location.source_id, location.audio_path)
      : await fetchAsset(location.audio_url, signal, onProgress);
    return audio_context.decodeAudioData(audio_data);
  }

  async load(location: GameplayLocation, audio_context: AudioContext, signal: AbortSignal,
    onProgress?: GameplayProgressCallback, prepared_audio?: AudioBuffer): Promise<GameplayData> {
    const skin_url = location.note_skin_url;
    if (!skin_url) throw new Error("No note skin is selected for this key mode");
    const local = location.source_id && location.audio_path && location.chart_path;
    const chart_source = local
      ? await readLocalChart(location.source_id!, location.chart_path!)
      : await fetchChart(location.chart_url, signal, (progress) => onProgress?.({ ...progress, id: "chart", label: "Chart" }));
    const [audio_buffer, chart] = await Promise.all([
      prepared_audio ?? this.loadAudio(location, audio_context, signal,
        (progress) => onProgress?.({ ...progress, id: "audio", label: "Music" })),
      Promise.resolve(parseOsuChart(chart_source)),
    ]);
    if (chart.mode === "osu") {
      const note_skin = await loadOsuStandardSkinUrl(skin_url, audio_context, signal,
        (progress) => onProgress?.({ ...progress, id: "skin", label: "Note skin" }));
      return { mode: "osu", audio_buffer, audio_context, chart, chart_id: location.chart_id,
        chart_md5: location.chart_md5, chart_index: location.chart_index,
        note_skin_id: location.note_skin_id, note_skin };
    }
    const note_skin = await loadOsuManiaSkinUrl(skin_url, chart.column_count, signal,
      (progress) => onProgress?.({ ...progress, id: "skin", label: "Note skin" }));
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
      chart_md5: location.chart_md5, chart_index: location.chart_index,
      note_skin_id: location.note_skin_id, note_skin, note_skin_source };
  }
}
