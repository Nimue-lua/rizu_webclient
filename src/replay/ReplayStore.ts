import type { CompletedGameplay } from "./RecordedReplay";

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
