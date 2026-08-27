import type { StoredPlay } from "./ReplayStore";

export interface OnlineScore {
  readonly id: number;
  readonly nickname: string;
  readonly score: number | null;
  readonly accuracy: number | null;
  readonly grade: string | null;
  readonly played_at: string;
  readonly replay_base: unknown;
}

function replayBase64(data: Uint8Array): string {
  let binary = "";
  const chunk_size = 0x8000;
  for (let offset = 0; offset < data.length; offset += chunk_size) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk_size));
  }
  return btoa(binary);
}

export async function submitPlay(play: StoredPlay, nickname: string, request: typeof fetch = fetch): Promise<void> {
  const response = await request("/api/scores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chart_id: play.chart_id,
      nickname: nickname.trim() || "Anonymous",
      mode: play.mode,
      played_at: play.played_at,
      score: play.score,
      accuracy: play.accuracy,
      grade: play.grade,
      combo: play.combo,
      max_combo: play.max_combo,
      misses: play.misses,
      music_rate: play.music_rate,
      judges: JSON.parse(play.judges_json),
      replay_base: JSON.parse(play.replay_base_json),
      replay: replayBase64(play.replay_data),
    }),
  });
  if (!response.ok) throw new Error(`Replay server returned ${response.status}`);
}

export async function listOnlineScores(chart_id: string, signal?: AbortSignal, request: typeof fetch = fetch): Promise<OnlineScore[]> {
  const response = await request(`/api/leaderboard?chart_id=${encodeURIComponent(chart_id)}&limit=5`, { signal });
  if (!response.ok) throw new Error(`Replay server returned ${response.status}`);
  const result = await response.json() as { scores?: unknown };
  return Array.isArray(result.scores) ? result.scores as OnlineScore[] : [];
}
