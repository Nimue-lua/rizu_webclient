import type { StoredPlay } from "./ReplayStore";

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
