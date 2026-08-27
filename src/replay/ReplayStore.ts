import type { CompletedGameplay } from "./RecordedReplay";
import { ManiaReplayBase, type ManiaReplayBaseValues } from "./mania/ManiaReplayBase";

const DATABASE_NAME = "rizu-gameplay";
const STORE_NAME = "plays";

export interface StoredPlay {
  readonly id?: number;
  readonly chart_id: string;
  readonly mode: "mania" | "osu";
  readonly played_at: string;
  readonly accuracy: number | null;
  readonly music_rate: number;
  readonly score_json: string;
  readonly replay_base_json: string;
  readonly replay_json: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
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
    score_json: JSON.stringify(completed.score),
    replay_base_json: JSON.stringify(completed.replay_base),
    replay_json: JSON.stringify(completed.replay),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function completedGameplayFromStoredPlay(play: StoredPlay): CompletedGameplay {
  const score: unknown = JSON.parse(play.score_json);
  const replay_base: unknown = JSON.parse(play.replay_base_json);
  const replay: unknown = JSON.parse(play.replay_json);
  if (!isObject(score) || !isObject(replay_base) || !isObject(replay)) throw new Error("Stored replay data is invalid");
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
  return { score, replay_base, replay } as unknown as CompletedGameplay;
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
