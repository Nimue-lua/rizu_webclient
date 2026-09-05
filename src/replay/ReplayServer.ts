import type { StoredPlay } from "./ReplayStore";
import { onlineClient } from "../online/OnlineClient";

export interface OnlineScore {
  readonly id: number;
  readonly chart_md5: string;
  readonly chart_index: number;
  readonly nickname: string;
  readonly mode: "mania" | "osu";
  readonly registered: boolean;
  readonly comment: string | null;
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

export interface PresenceStatus {
  readonly count: number;
  readonly players: readonly OnlinePlayer[];
}

export interface OnlinePlayer {
  readonly id: string;
  readonly name: string;
  readonly speed: number;
  readonly stamina: number;
  readonly dexterity: number;
  readonly technical: number;
  readonly accuracy: number | null;
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

export interface LeaderboardDefinition {
  readonly slug: string;
  readonly name: string;
  readonly mode: "mania" | "osu" | null;
  readonly keys: number | null;
}

export interface SkillLeaderboardResponse {
  readonly leaderboards: SkillLeaderboards;
  readonly available: readonly LeaderboardDefinition[];
}

export function subscribeAccountChanges(listener: () => void): () => void {
  return onlineClient.subscribeAccountChanges(listener);
}

async function accountRequest(path: string, name: string, password: string, request: typeof fetch): Promise<OnlineUser> {
  const response = await request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
  const result = await response.json() as { user?: OnlineUser; token?: string; error?: string };
  if (!response.ok || !result.user || !result.token) throw new Error(result.error ?? `Replay server returned ${response.status}`);
  onlineClient.setToken(result.token);
  return result.user;
}

export function register(name: string, password: string, request: typeof fetch = onlineClient.request): Promise<OnlineUser> {
  return accountRequest("/api/register", name, password, request);
}

export function login(name: string, password: string, request: typeof fetch = onlineClient.request): Promise<OnlineUser> {
  return accountRequest("/api/login", name, password, request);
}

export async function currentUser(request: typeof fetch = onlineClient.request): Promise<OnlineUser | null> {
  const response = await request("/api/me", { headers: onlineClient.authorizationHeaders() });
  if (!response.ok) throw new Error(`Replay server returned ${response.status}`);
  return (await response.json() as { user?: OnlineUser | null }).user ?? null;
}

export async function logout(request: typeof fetch = onlineClient.request): Promise<void> {
  const response = await request("/api/logout", { method: "POST", headers: onlineClient.authorizationHeaders() });
  if (!response.ok) throw new Error(`Replay server returned ${response.status}`);
  onlineClient.clearToken();
}

export async function reportPresence(request: typeof fetch = onlineClient.request): Promise<PresenceStatus> {
  const response = await request("/api/presence", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...onlineClient.authorizationHeaders() },
    body: JSON.stringify({ client_id: onlineClient.clientId() }),
  });
  if (!response.ok) throw new Error(`Replay server returned ${response.status}`);
  const result = await response.json() as Partial<PresenceStatus>;
  if (!Number.isInteger(result.count) || (result.count ?? -1) < 0) throw new Error("Replay server returned an invalid presence count");
  if (!Array.isArray(result.players)) throw new Error("Replay server returned an invalid player list");
  return { count: result.count!, players: result.players };
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
  request: typeof fetch = onlineClient.request): Promise<number> {
  const response = await request("/api/scores", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...onlineClient.authorizationHeaders() },
    body: JSON.stringify({
      chart_md5,
      chart_index,
      mode: play.mode,
      played_at: play.played_at,
      replay_base: JSON.parse(play.replay_base_json),
      replay: replayBase64(play.replay_data),
    }),
  });
  if (!response.ok) throw new Error(`Replay server returned ${response.status}`);
  const result = await response.json() as { id?: unknown };
  if (!Number.isSafeInteger(result.id) || (result.id as number) < 1) throw new Error("Replay server returned an invalid score ID");
  return result.id as number;
}

export async function updateScoreComment(score_id: number, comment: string,
  request: typeof fetch = onlineClient.request): Promise<string | null> {
  const response = await request(`/api/scores/${score_id}/comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...onlineClient.authorizationHeaders() },
    body: JSON.stringify({ comment }),
  });
  const result = await response.json() as { comment?: unknown; error?: string };
  if (!response.ok) throw new Error(result.error ?? `Replay server returned ${response.status}`);
  if (result.comment !== null && typeof result.comment !== "string") throw new Error("Replay server returned an invalid comment");
  return result.comment;
}

export async function listOnlineScores(chart_md5: string, chart_index: number, signal?: AbortSignal,
  request: typeof fetch = onlineClient.request): Promise<OnlineScore[]> {
  const response = await request(`/api/leaderboard?chart_md5=${encodeURIComponent(chart_md5)}&chart_index=${chart_index}&limit=5`, { signal });
  if (!response.ok) throw new Error(`Replay server returned ${response.status}`);
  const result = await response.json() as { scores?: unknown };
  return Array.isArray(result.scores) ? result.scores as OnlineScore[] : [];
}

export async function listRecentPlays(signal?: AbortSignal, request: typeof fetch = onlineClient.request): Promise<OnlineScore[]> {
  const response = await request("/api/scores/recent?limit=50", { signal });
  if (!response.ok) throw new Error(`Replay server returned ${response.status}`);
  const result = await response.json() as { scores?: unknown };
  return Array.isArray(result.scores) ? result.scores as OnlineScore[] : [];
}

export async function listSkillLeaderboards(signal?: AbortSignal, request: typeof fetch = onlineClient.request,
  leaderboard = "all"): Promise<SkillLeaderboardResponse> {
  const response = await request(`/api/rankings?leaderboard=${encodeURIComponent(leaderboard)}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Replay server returned ${response.status}`);
  const result = await response.json() as { leaderboards?: Partial<Record<SkillName, unknown>> };
  const available = (result as { available?: unknown }).available;
  return { leaderboards: {
    speed: Array.isArray(result.leaderboards?.speed) ? result.leaderboards.speed as SkillRanking[] : [],
    dexterity: Array.isArray(result.leaderboards?.dexterity) ? result.leaderboards.dexterity as SkillRanking[] : [],
    stamina: Array.isArray(result.leaderboards?.stamina) ? result.leaderboards.stamina as SkillRanking[] : [],
    technical: Array.isArray(result.leaderboards?.technical) ? result.leaderboards.technical as SkillRanking[] : [],
  }, available: Array.isArray(available) ? available as LeaderboardDefinition[] : [] };
}

export async function loadScoreStats(signal?: AbortSignal, request: typeof fetch = onlineClient.request): Promise<ScoreStats> {
  const response = await request("/api/scores/stats", { signal });
  if (!response.ok) throw new Error(`Replay server returned ${response.status}`);
  const result = await response.json() as Partial<ScoreStats>;
  return {
    total: typeof result.total === "number" ? result.total : 0,
    today: typeof result.today === "number" ? result.today : 0,
  };
}
