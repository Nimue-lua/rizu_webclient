import type { StoredPlay } from "./ReplayStore";

export interface OnlineScore {
  readonly id: number;
  readonly chart_md5: string;
  readonly chart_index: number;
  readonly nickname: string;
  readonly mode: "mania" | "osu";
  readonly registered: boolean;
  readonly score: number | null;
  readonly accuracy: number | null;
  readonly grade: string | null;
  readonly played_at: string;
  readonly submitted_at: string;
  readonly title: string;
  readonly artist: string;
  readonly chart_name: string;
  readonly keys: number | null;
  readonly replay_base: unknown;
  readonly difficulty: number;
  readonly max_skill_difficulty: number;
}

export interface OnlineUser {
  readonly id: number;
  readonly name: string;
}

export interface ScoreStats {
  readonly total: number;
  readonly today: number;
}

export type SkillName = "speed" | "dexterity" | "stamina" | "technical";

export interface SkillRanking {
  readonly rank: number;
  readonly user_id: number;
  readonly nickname: string;
  readonly rating: number;
  readonly play_count: number;
}

export type SkillLeaderboards = Record<SkillName, readonly SkillRanking[]>;

const TOKEN_KEY = "rizu.online.token";
const account_listeners = new Set<() => void>();

function notifyAccountChange(): void {
  for (const listener of account_listeners) listener();
}

export function subscribeAccountChanges(listener: () => void): () => void {
  account_listeners.add(listener);
  return () => account_listeners.delete(listener);
}

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function authorizationHeaders(): Record<string, string> {
  const token = storage()?.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function accountRequest(path: string, name: string, password: string, request: typeof fetch): Promise<OnlineUser> {
  const response = await request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
  const result = await response.json() as { user?: OnlineUser; token?: string; error?: string };
  if (!response.ok || !result.user || !result.token) throw new Error(result.error ?? `Replay server returned ${response.status}`);
  storage()?.setItem(TOKEN_KEY, result.token);
  notifyAccountChange();
  return result.user;
}

export function register(name: string, password: string, request: typeof fetch = fetch): Promise<OnlineUser> {
  return accountRequest("/api/register", name, password, request);
}

export function login(name: string, password: string, request: typeof fetch = fetch): Promise<OnlineUser> {
  return accountRequest("/api/login", name, password, request);
}

export async function currentUser(request: typeof fetch = fetch): Promise<OnlineUser | null> {
  const response = await request("/api/me", { headers: authorizationHeaders() });
  if (!response.ok) throw new Error(`Replay server returned ${response.status}`);
  return (await response.json() as { user?: OnlineUser | null }).user ?? null;
}

export async function logout(request: typeof fetch = fetch): Promise<void> {
  const response = await request("/api/logout", { method: "POST", headers: authorizationHeaders() });
  if (!response.ok) throw new Error(`Replay server returned ${response.status}`);
  storage()?.removeItem(TOKEN_KEY);
  notifyAccountChange();
}

function replayBase64(data: Uint8Array): string {
  let binary = "";
  const chunk_size = 0x8000;
  for (let offset = 0; offset < data.length; offset += chunk_size) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk_size));
  }
  return btoa(binary);
}

export async function submitPlay(play: StoredPlay, chart_md5: string, chart_index: number,
  request: typeof fetch = fetch): Promise<void> {
  const response = await request("/api/scores", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authorizationHeaders() },
    body: JSON.stringify({
      chart_md5,
      chart_index,
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

export async function listOnlineScores(chart_md5: string, chart_index: number, signal?: AbortSignal,
  request: typeof fetch = fetch): Promise<OnlineScore[]> {
  const response = await request(`/api/leaderboard?chart_md5=${encodeURIComponent(chart_md5)}&chart_index=${chart_index}&limit=5`, { signal });
  if (!response.ok) throw new Error(`Replay server returned ${response.status}`);
  const result = await response.json() as { scores?: unknown };
  return Array.isArray(result.scores) ? result.scores as OnlineScore[] : [];
}

export async function listRecentPlays(signal?: AbortSignal, request: typeof fetch = fetch): Promise<OnlineScore[]> {
  const response = await request("/api/scores/recent?limit=50", { signal });
  if (!response.ok) throw new Error(`Replay server returned ${response.status}`);
  const result = await response.json() as { scores?: unknown };
  return Array.isArray(result.scores) ? result.scores as OnlineScore[] : [];
}

export async function listSkillLeaderboards(signal?: AbortSignal, request: typeof fetch = fetch): Promise<SkillLeaderboards> {
  const response = await request("/api/rankings", { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Replay server returned ${response.status}`);
  const result = await response.json() as { leaderboards?: Partial<Record<SkillName, unknown>> };
  return {
    speed: Array.isArray(result.leaderboards?.speed) ? result.leaderboards.speed as SkillRanking[] : [],
    dexterity: Array.isArray(result.leaderboards?.dexterity) ? result.leaderboards.dexterity as SkillRanking[] : [],
    stamina: Array.isArray(result.leaderboards?.stamina) ? result.leaderboards.stamina as SkillRanking[] : [],
    technical: Array.isArray(result.leaderboards?.technical) ? result.leaderboards.technical as SkillRanking[] : [],
  };
}

export async function loadScoreStats(signal?: AbortSignal, request: typeof fetch = fetch): Promise<ScoreStats> {
  const response = await request("/api/scores/stats", { signal });
  if (!response.ok) throw new Error(`Replay server returned ${response.status}`);
  const result = await response.json() as Partial<ScoreStats>;
  return {
    total: typeof result.total === "number" ? result.total : 0,
    today: typeof result.today === "number" ? result.today : 0,
  };
}
