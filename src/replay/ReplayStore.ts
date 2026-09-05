import { strFromU8, strToU8, zlibSync, unzlibSync } from "fflate";
import { OSU_STANDARD_JUDGE_NAMES } from "../gameplay/osu/scoring/OsuStandardScore";
import type { ScoreResult } from "../gameplay/scoring/ScoreResult";
import type { CompletedGameplay } from "./RecordedReplay";
import { ManiaReplayBase, type ManiaReplayBaseValues } from "./mania/ManiaReplayBase";

const DATABASE_NAME = "rizu-gameplay";
const STORE_NAME = "plays";
const DATABASE_VERSION = 3;

export interface StoredPlay {
  readonly id?: number;
  readonly chart_id: string;
  readonly mode: "mania" | "osu";
  readonly played_at: string;
  readonly accuracy: number | null;
  readonly music_rate: number;
  readonly score: number | null;
  readonly grade: string | null;
  readonly combo: number | null;
  readonly max_combo: number | null;
  readonly misses: number;
  readonly judges_json: string;
  readonly last_judge: string | null;
  readonly replay_base_json: string;
  readonly replay_data: Uint8Array;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (request.result.objectStoreNames.contains(STORE_NAME)) request.result.deleteObjectStore(STORE_NAME);
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      store.createIndex("chart_id", "chart_id");
      store.createIndex("played_at", "played_at");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open gameplay storage"));
  });
}

export function storedPlay(chart_id: string, completed: CompletedGameplay, played_at = new Date()): StoredPlay {
  return {
    chart_id,
    mode: completed.replay.mode,
    played_at: played_at.toISOString(),
    accuracy: completed.score.accuracy ?? null,
    music_rate: completed.replay_base.rate,
    score: completed.score.score ?? 0,
    grade: completed.score.grade ?? null,
    combo: completed.score.combo ?? null,
    max_combo: completed.score.max_combo ?? null,
    misses: completed.score.judges?.miss ?? 0,
    judges_json: JSON.stringify(completed.score.judges ?? {}),
    last_judge: completed.score.last_judge ?? null,
    replay_base_json: JSON.stringify(completed.replay_base),
    replay_data: zlibSync(strToU8(JSON.stringify(completed.replay)), { level: 9 }),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function completedGameplayFromStoredPlay(play: StoredPlay): CompletedGameplay {
  const judges: unknown = JSON.parse(play.judges_json);
  const replay_base: unknown = JSON.parse(play.replay_base_json);
  const replay: unknown = JSON.parse(strFromU8(unzlibSync(play.replay_data)));
  if (!isObject(judges)) throw new Error("Stored replay data is invalid");
  if (!isObject(replay_base) || !isObject(replay)) throw new Error("Stored replay data is invalid");
  if (replay.mode !== play.mode || replay_base.mode !== play.mode) throw new Error("Stored replay modes do not match");
  if (replay.version !== 1 || replay.time_unit !== "1/8192 second") throw new Error("Stored replay version is unsupported");
  if (!Number.isFinite(replay_base.rate) || (replay_base.rate as number) <= 0) throw new Error("Stored replay rate is invalid");
  if (!Array.isArray(replay.input_events)) throw new Error("Stored replay inputs are invalid");
  if (play.mode === "mania") {
    if (!Array.isArray(replay.logic_events)) throw new Error("Stored mania replay events are invalid");
    const imported_base = new ManiaReplayBase();
    imported_base.importReplayBase(replay_base as unknown as ManiaReplayBaseValues);
  } else if (!Array.isArray(replay.judgment_events)) {
    throw new Error("Stored osu replay events are invalid");
  }
  const score: ScoreResult = {
    ...(play.score === null ? {} : { score: play.score }),
    ...(play.accuracy === null ? {} : { accuracy: play.accuracy }),
    ...(play.grade === null ? {} : { grade: play.grade }),
    ...(play.combo === null ? {} : { combo: play.combo }),
    ...(play.max_combo === null ? {} : { max_combo: play.max_combo }),
    judges: judges as Readonly<Record<string, number>>,
    judge_names: play.mode === "osu" ? OSU_STANDARD_JUDGE_NAMES : Object.keys(judges),
    last_judge: play.last_judge,
  };
  return { score, replay_base, replay } as unknown as CompletedGameplay;
}

export function deleteScoreDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not delete local scores"));
    request.onblocked = () => reject(new Error("Could not delete local scores because the database is in use"));
  });
}

export async function savePlay(play: StoredPlay): Promise<number> {
  const database = await openDatabase();
  try {
    return await new Promise<number>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const request = transaction.objectStore(STORE_NAME).add(play);
      transaction.oncomplete = () => resolve(request.result as number);
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save gameplay result"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not save gameplay result"));
    });
  } finally {
    database.close();
  }
}

export async function listPlaysByChart(chart_id: string): Promise<StoredPlay[]> {
  const database = await openDatabase();
  try {
    return await new Promise<StoredPlay[]>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).index("chart_id").getAll(chart_id);
      request.onsuccess = () => resolve(request.result as StoredPlay[]);
      request.onerror = () => reject(request.error ?? new Error("Could not load gameplay results"));
    });
  } finally {
    database.close();
  }
}
