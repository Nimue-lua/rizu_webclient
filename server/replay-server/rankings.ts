import type { DatabaseSync } from "node:sqlite";
import type { CatalogChartRow, JsonObject } from "./types.ts";

export const SKILLS = ["speed", "dexterity", "stamina", "technical"] as const;
export type Skill = typeof SKILLS[number];
const SKILL_PLAY_COUNT = 20;
const MAX_RESULTS = 50;

interface LeaderboardRow { id: number; slug: string; name: string; mode: string | null; keys: number | null }
interface CachedUserRow {
  user_id: number; nickname: string; speed: number; speed_count: number; dexterity: number; dexterity_count: number;
  stamina: number; stamina_count: number; technical: number; technical_count: number; accuracy: number | null;
}

export function skillRating(difficulty: unknown, accuracy: unknown): number {
  const safe_difficulty = typeof difficulty === "number" && Number.isFinite(difficulty) ? Math.max(0, difficulty) : 0;
  const safe_accuracy = typeof accuracy === "number" && Number.isFinite(accuracy) ? Math.min(1, Math.max(0, accuracy)) : 0;
  if (safe_accuracy <= 0.8) return 0;
  if (safe_accuracy === 0.9) return safe_difficulty * 0.5;
  if (safe_accuracy === 0.95) return safe_difficulty;
  if (safe_accuracy <= 0.9) return safe_difficulty * (safe_accuracy - 0.8) * 5;
  if (safe_accuracy <= 0.95) return safe_difficulty * (0.5 + (safe_accuracy - 0.9) * 10);
  if (safe_accuracy < 1) return safe_difficulty + (safe_accuracy - 0.95) * 40;
  return safe_difficulty + 2;
}

function matchingLeaderboards(database: DatabaseSync, mode: string, keys: number | null): LeaderboardRow[] {
  return database.prepare(`
    SELECT id, slug, name, mode, keys FROM leaderboards
    WHERE mode IS NULL OR (mode = ? AND (keys IS NULL OR keys = ? OR (keys = -1 AND ? NOT IN (4, 7, 10))))
    ORDER BY sort_order, id
  `).all(mode, keys, keys) as unknown as LeaderboardRow[];
}

function updateLeaderboardUser(database: DatabaseSync, leaderboard_id: number, user_id: number): void {
  const values: unknown[] = [];
  for (const skill of SKILLS) {
    const rows = database.prepare(`
      SELECT rating FROM leaderboard_skill_plays
      WHERE leaderboard_id = ? AND user_id = ? AND skill = ? ORDER BY rating DESC LIMIT ?
    `).all(leaderboard_id, user_id, skill, SKILL_PLAY_COUNT) as unknown as { rating: number }[];
    values.push(rows.reduce((sum, row) => sum + row.rating, 0) / SKILL_PLAY_COUNT, rows.length);
  }
  const accuracy = database.prepare(`
    SELECT AVG(accuracy) AS accuracy FROM (
      SELECT accuracy FROM leaderboard_chart_plays WHERE leaderboard_id = ? AND user_id = ?
      ORDER BY rating DESC LIMIT 50
    )
  `).get(leaderboard_id, user_id) as { accuracy: number | null };
  database.prepare(`
    INSERT INTO leaderboard_users (leaderboard_id, user_id, speed, speed_count, dexterity, dexterity_count,
      stamina, stamina_count, technical, technical_count, accuracy, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(leaderboard_id, user_id) DO UPDATE SET speed=excluded.speed, speed_count=excluded.speed_count,
      dexterity=excluded.dexterity, dexterity_count=excluded.dexterity_count, stamina=excluded.stamina,
      stamina_count=excluded.stamina_count, technical=excluded.technical, technical_count=excluded.technical_count,
      accuracy=excluded.accuracy, updated_at=excluded.updated_at
  `).run(leaderboard_id, user_id, values[0] as number, values[1] as number, values[2] as number,
    values[3] as number, values[4] as number, values[5] as number, values[6] as number,
    values[7] as number, accuracy.accuracy, new Date().toISOString());
}

export function cacheScoreRanking(database: DatabaseSync, score_id: number, user_id: number,
  chart_md5: string, chart_index: number, mode: string, accuracy: number, chart: CatalogChartRow): void {
  for (const leaderboard of matchingLeaderboards(database, mode, chart.keys)) {
    const ratings = SKILLS.map((skill) => skillRating(chart[skill], accuracy));
    const overall_rating = Math.hypot(...ratings);
    database.prepare(`
      INSERT INTO leaderboard_chart_plays (leaderboard_id, user_id, chart_md5, chart_index, rating, accuracy, score_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(leaderboard_id, user_id, chart_md5, chart_index) DO UPDATE SET
        rating=excluded.rating, accuracy=excluded.accuracy, score_id=excluded.score_id
      WHERE excluded.rating > leaderboard_chart_plays.rating
    `).run(leaderboard.id, user_id, chart_md5, chart_index, overall_rating, accuracy, score_id);
    for (let index = 0; index < SKILLS.length; index++) {
      database.prepare(`
        INSERT INTO leaderboard_skill_plays (leaderboard_id, user_id, chart_md5, chart_index, skill, rating, score_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(leaderboard_id, user_id, chart_md5, chart_index, skill) DO UPDATE SET
          rating=excluded.rating, score_id=excluded.score_id
        WHERE excluded.rating > leaderboard_skill_plays.rating
      `).run(leaderboard.id, user_id, chart_md5, chart_index, SKILLS[index], ratings[index], score_id);
    }
    updateLeaderboardUser(database, leaderboard.id, user_id);
  }
}

export function listLeaderboards(database: DatabaseSync): JsonObject[] {
  return database.prepare("SELECT slug, name, mode, NULLIF(keys, -1) AS keys FROM leaderboards ORDER BY sort_order, id").all() as JsonObject[];
}

export function skillLeaderboards(database: DatabaseSync, slug = "all"): Record<Skill, JsonObject[]> | null {
  const leaderboard = database.prepare("SELECT id FROM leaderboards WHERE slug = ?").get(slug) as { id: number } | undefined;
  if (!leaderboard) return null;
  const result = {} as Record<Skill, JsonObject[]>;
  for (const skill of SKILLS) {
    const count_column = `${skill}_count` as keyof CachedUserRow;
    const rows = database.prepare(`
      SELECT leaderboard_users.user_id, users.name AS nickname, ${skill}, ${skill}_count,
        ROW_NUMBER() OVER (ORDER BY ${skill} DESC, users.name COLLATE NOCASE) AS rank
      FROM leaderboard_users JOIN users ON users.id = leaderboard_users.user_id
      WHERE leaderboard_id = ? AND ${skill} > 0 ORDER BY ${skill} DESC, users.name COLLATE NOCASE LIMIT ?
    `).all(leaderboard.id, MAX_RESULTS) as unknown as (CachedUserRow & { rank: number })[];
    result[skill] = rows.map((row) => ({ rank: row.rank, user_id: row.user_id, nickname: row.nickname,
      rating: row[skill], play_count: row[count_column] }));
  }
  return result;
}

export function playerSummary(database: DatabaseSync, user_id: number): JsonObject | undefined {
  return database.prepare(`
    SELECT speed, stamina, dexterity, technical, accuracy FROM leaderboard_users
    WHERE user_id = ? AND leaderboard_id = (SELECT id FROM leaderboards WHERE slug = 'all')
  `).get(user_id) as JsonObject | undefined;
}

export function rebuildCaches(database: DatabaseSync, catalog: DatabaseSync): void {
  const current = database.prepare("SELECT value FROM server_state WHERE key = 'cache_version'").get() as { value: string } | undefined;
  if (current?.value === "1") return;
  const scores = database.prepare(`SELECT id, user_id, chart_md5, chart_index, mode, accuracy, score, metadata_json
    FROM scores WHERE user_id IS NOT NULL ORDER BY id`).all() as unknown as {
      id: number; user_id: number; chart_md5: string; chart_index: number; mode: string;
      accuracy: number | null; score: number | null; metadata_json: string;
    }[];
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec("DELETE FROM leaderboard_skill_plays; DELETE FROM leaderboard_chart_plays; DELETE FROM leaderboard_users;");
    database.exec("UPDATE users SET score_count = 0, total_score = 0, play_time_seconds = 0");
    for (const score of scores) {
      const chart = catalogChartForRebuild(catalog, score.chart_md5, score.chart_index);
      if (!chart) continue;
      let rate = 1;
      try {
        const metadata = JSON.parse(score.metadata_json) as Record<string, unknown>;
        if (typeof metadata.music_rate === "number" && Number.isFinite(metadata.music_rate) && metadata.music_rate > 0) rate = metadata.music_rate;
      } catch { /* Keep the safe default for legacy malformed metadata. */ }
      const duration = chart.duration_seconds / rate;
      database.prepare("UPDATE scores SET duration_seconds = ? WHERE id = ?").run(duration, score.id);
      database.prepare(`UPDATE users SET score_count = score_count + 1, total_score = total_score + ?,
        play_time_seconds = play_time_seconds + ? WHERE id = ?`).run(score.score ?? 0, duration, score.user_id);
      if (score.accuracy !== null && Number.isFinite(score.accuracy)) {
        cacheScoreRanking(database, score.id, score.user_id, score.chart_md5, score.chart_index, score.mode, score.accuracy, chart);
      }
    }
    database.prepare("INSERT OR REPLACE INTO server_state (key, value) VALUES ('cache_version', '1')").run();
    database.exec("COMMIT");
  } catch (reason) {
    database.exec("ROLLBACK");
    throw reason;
  }
}

function catalogChartForRebuild(catalog: DatabaseSync, chart_md5: string, chart_index: number): CatalogChartRow | undefined {
  return catalog.prepare(`SELECT charts.difficulty, charts.speed, charts.dexterity, charts.stamina, charts.technical,
    charts.duration_seconds, charts.mode, charts.keys, charts.name, charts.background_preview_path, songs.title, songs.artist
    FROM charts JOIN songs ON songs.id = charts.song_id WHERE charts.chart_md5 = ? AND charts.chart_index = ?`)
    .get(chart_md5, chart_index) as unknown as CatalogChartRow | undefined;
}
