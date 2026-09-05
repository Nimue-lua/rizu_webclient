import type { DatabaseSync } from "node:sqlite";
import type { JsonObject } from "./types.ts";

const MAX_RESULTS = 50;

interface LeaderboardRow { id: number; slug: string; name: string; mode: string | null; keys: number | null }

function matchingLeaderboards(database: DatabaseSync, mode: string, keys: number | null): LeaderboardRow[] {
  return database.prepare(`
    SELECT id, slug, name, mode, keys FROM leaderboards
    WHERE mode IS NULL OR (mode = ? AND (keys IS NULL OR keys = ? OR (keys = -1 AND ? NOT IN (4, 7, 10))))
    ORDER BY sort_order, id
  `).all(mode, keys, keys) as unknown as LeaderboardRow[];
}

export function cacheScoreRanking(database: DatabaseSync, user_id: number, mode: string, keys: number | null,
  score: number, accuracy: number, duration_seconds: number): void {
  for (const leaderboard of matchingLeaderboards(database, mode, keys)) {
    database.prepare(`
      INSERT INTO leaderboard_users (leaderboard_id, user_id, total_score, accuracy_sum,
        play_time_seconds, score_count, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(leaderboard_id, user_id) DO UPDATE SET
        total_score = leaderboard_users.total_score + excluded.total_score,
        accuracy_sum = leaderboard_users.accuracy_sum + excluded.accuracy_sum,
        play_time_seconds = leaderboard_users.play_time_seconds + excluded.play_time_seconds,
        score_count = leaderboard_users.score_count + 1,
        updated_at = excluded.updated_at
    `).run(leaderboard.id, user_id, score, accuracy, duration_seconds, new Date().toISOString());
  }
}

export function listLeaderboards(database: DatabaseSync): JsonObject[] {
  return database.prepare("SELECT slug, name, mode, NULLIF(keys, -1) AS keys FROM leaderboards ORDER BY sort_order, id").all() as JsonObject[];
}

export function scoreLeaderboard(database: DatabaseSync, slug = "all"): JsonObject[] | null {
  const leaderboard = database.prepare("SELECT id FROM leaderboards WHERE slug = ?").get(slug) as { id: number } | undefined;
  if (!leaderboard) return null;
  return database.prepare(`
    SELECT leaderboard_users.user_id, users.name AS nickname, leaderboard_users.total_score,
      leaderboard_users.accuracy_sum / leaderboard_users.score_count AS accuracy,
      leaderboard_users.play_time_seconds, leaderboard_users.score_count,
      ROW_NUMBER() OVER (ORDER BY leaderboard_users.total_score DESC,
        leaderboard_users.accuracy_sum / leaderboard_users.score_count DESC,
        users.name COLLATE NOCASE) AS rank
    FROM leaderboard_users JOIN users ON users.id = leaderboard_users.user_id
    WHERE leaderboard_id = ? AND leaderboard_users.score_count > 0
    ORDER BY leaderboard_users.total_score DESC, accuracy DESC, users.name COLLATE NOCASE LIMIT ?
  `).all(leaderboard.id, MAX_RESULTS) as JsonObject[];
}

export function playerSummary(database: DatabaseSync, user_id: number): JsonObject | undefined {
  return database.prepare(`
    WITH ranked AS (
      SELECT leaderboard_users.user_id, leaderboard_users.total_score,
        leaderboard_users.accuracy_sum / leaderboard_users.score_count AS accuracy, leaderboard_users.play_time_seconds,
        leaderboard_users.score_count,
        ROW_NUMBER() OVER (ORDER BY leaderboard_users.total_score DESC,
          leaderboard_users.accuracy_sum / leaderboard_users.score_count DESC,
          users.name COLLATE NOCASE) AS rank
      FROM leaderboard_users JOIN users ON users.id = leaderboard_users.user_id
      WHERE leaderboard_id = (SELECT id FROM leaderboards WHERE slug = 'all') AND leaderboard_users.score_count > 0
    )
    SELECT total_score, accuracy, play_time_seconds, score_count, rank FROM ranked WHERE user_id = ?
  `).get(user_id) as JsonObject | undefined;
}

export function rebuildCaches(database: DatabaseSync, catalog: DatabaseSync): void {
  const current = database.prepare("SELECT value FROM server_state WHERE key = 'cache_version'").get() as { value: string } | undefined;
  if (current?.value === "2") return;
  const scores = database.prepare(`SELECT id, user_id, chart_md5, chart_index, mode, accuracy, score, metadata_json
    FROM scores WHERE user_id IS NOT NULL AND validation_state IN ('valid', 'unverified') ORDER BY id`).all() as unknown as {
      id: number; user_id: number; chart_md5: string; chart_index: number; mode: string;
      accuracy: number | null; score: number | null; metadata_json: string;
    }[];
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec("DELETE FROM leaderboard_users; UPDATE users SET score_count = 0, total_score = 0, play_time_seconds = 0");
    for (const score of scores) {
      const chart = catalog.prepare("SELECT duration_seconds, keys FROM charts WHERE chart_md5 = ? AND chart_index = ?")
        .get(score.chart_md5, score.chart_index) as { duration_seconds: number; keys: number | null } | undefined;
      if (!chart) continue;
      let rate = 1;
      try {
        const metadata = JSON.parse(score.metadata_json) as Record<string, unknown>;
        const replay_base = metadata.replay_base as Record<string, unknown> | undefined;
        if (typeof replay_base?.rate === "number" && Number.isFinite(replay_base.rate) && replay_base.rate > 0) rate = replay_base.rate;
      } catch { /* Keep the safe default for legacy malformed metadata. */ }
      const duration = chart.duration_seconds / rate;
      database.prepare("UPDATE scores SET duration_seconds = ? WHERE id = ?").run(duration, score.id);
      database.prepare(`UPDATE users SET score_count = score_count + 1, total_score = total_score + ?,
        play_time_seconds = play_time_seconds + ? WHERE id = ?`).run(score.score ?? 0, duration, score.user_id);
      if (score.accuracy !== null && Number.isFinite(score.accuracy)) {
        cacheScoreRanking(database, score.user_id, score.mode, chart.keys, score.score ?? 0, score.accuracy, duration);
      }
    }
    database.prepare("INSERT OR REPLACE INTO server_state (key, value) VALUES ('cache_version', '2')").run();
    database.exec("COMMIT");
  } catch (reason) {
    database.exec("ROLLBACK");
    throw reason;
  }
}
