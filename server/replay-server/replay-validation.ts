import type { DatabaseSync } from "node:sqlite";
import type { ReplayValidationResult, ReplayValidator } from "./types.ts";
import { catalogChart } from "./catalog.ts";
import { cacheScoreRanking } from "./rankings.ts";
import { RetryableChartError } from "./chart-store.ts";
import { REPLAY_COMPUTE_VERSION } from "./replay-verifier.ts";

const MAX_VALIDATION_ATTEMPTS = 3;

interface JobRow {
  score_id: number; user_id: number | null; chart_md5: string; chart_index: number; mode: "mania" | "osu";
  replay: Uint8Array; metadata_json: string;
}

function finiteResult(result: ReplayValidationResult): boolean {
  return Number.isFinite(result.accuracy) && result.accuracy >= 0 && result.accuracy <= 1 &&
    Number.isFinite(result.score) && result.score >= 0 && Number.isFinite(result.music_rate) &&
    result.music_rate >= 0.25 && result.music_rate <= 4;
}

export async function processValidationJobs(database: DatabaseSync, catalog: DatabaseSync,
  validator: ReplayValidator, limit = 100): Promise<{ valid: number; invalid: number }> {
  const jobs = database.prepare(`
    SELECT scores.id AS score_id, scores.user_id, scores.chart_md5, scores.chart_index, scores.mode,
      scores.replay, scores.metadata_json
    FROM validation_jobs JOIN scores ON scores.id = validation_jobs.score_id
    WHERE validation_jobs.state = 'queued' AND validation_jobs.compute_version = ?
      AND scores.validation_state = 'queued' ORDER BY scores.id LIMIT ?
  `).all(REPLAY_COMPUTE_VERSION, limit) as unknown as JobRow[];
  let valid = 0;
  let invalid = 0;
  for (const job of jobs) {
    const claimed = database.prepare(`UPDATE validation_jobs SET state = 'running', attempts = attempts + 1, updated_at = ?
      WHERE score_id = ? AND state = 'queued' AND compute_version = ?`)
      .run(new Date().toISOString(), job.score_id, REPLAY_COMPUTE_VERSION);
    if (claimed.changes === 0) continue;
    try {
      const metadata = JSON.parse(job.metadata_json) as Record<string, unknown>;
      const result = await validator({ id: job.score_id, chart_md5: job.chart_md5, chart_index: job.chart_index,
        mode: job.mode, replay: job.replay, replay_base: metadata.replay_base });
      if (!finiteResult(result)) throw new Error("Validator returned an invalid score result");
      const next_metadata = { ...metadata, ...result };
      const chart = catalogChart(catalog, job.chart_md5, job.chart_index);
      if (!chart) throw new Error("Chart is no longer in the catalog");
      const duration_seconds = chart.duration_seconds / result.music_rate;
      database.exec("BEGIN IMMEDIATE");
      try {
        const completed = database.prepare(`UPDATE validation_jobs SET state = 'succeeded', updated_at = ?, last_error = NULL
          WHERE score_id = ? AND state = 'running' AND compute_version = ?`)
          .run(new Date().toISOString(), job.score_id, REPLAY_COMPUTE_VERSION);
        if (completed.changes !== 1) throw new Error("Validation job claim was lost");
        const promoted = database.prepare(`UPDATE scores SET score = ?, accuracy = ?, duration_seconds = ?, metadata_json = ?,
          validation_state = 'valid', validation_error = NULL WHERE id = ? AND validation_state = 'queued'`)
          .run(result.score, result.accuracy, duration_seconds, JSON.stringify(next_metadata), job.score_id);
        if (promoted.changes !== 1) throw new Error("Score validation state changed while processing");
        if (job.user_id !== null) {
          database.prepare(`UPDATE users SET score_count = score_count + 1, total_score = total_score + ?,
            play_time_seconds = play_time_seconds + ? WHERE id = ?`)
            .run(result.score, duration_seconds, job.user_id);
          cacheScoreRanking(database, job.user_id, job.mode, chart.keys, result.score, result.accuracy, duration_seconds);
        }
        database.exec("COMMIT");
      } catch (reason) {
        database.exec("ROLLBACK");
        throw reason;
      }
      valid++;
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      const attempts = database.prepare("SELECT attempts FROM validation_jobs WHERE score_id = ?").get(job.score_id) as { attempts: number };
      if (reason instanceof RetryableChartError && attempts.attempts < MAX_VALIDATION_ATTEMPTS) {
        database.prepare("UPDATE validation_jobs SET state = 'queued', updated_at = ?, last_error = ? WHERE score_id = ?")
          .run(new Date().toISOString(), error, job.score_id);
        continue;
      }
      const failed = database.prepare(`UPDATE validation_jobs SET state = 'failed', updated_at = ?, last_error = ?
        WHERE score_id = ? AND state = 'running' AND compute_version = ?`)
        .run(new Date().toISOString(), error, job.score_id, REPLAY_COMPUTE_VERSION);
      if (failed.changes === 1) {
        database.prepare(`UPDATE scores SET validation_state = 'invalid', validation_error = ?
          WHERE id = ? AND validation_state = 'queued'`).run(error, job.score_id);
        invalid++;
      }
    }
  }
  return { valid, invalid };
}

export function queueUnverifiedScores(database: DatabaseSync): number {
  const now = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = database.prepare(`INSERT INTO validation_jobs (score_id, state, updated_at, compute_version)
      SELECT id, 'queued', ?, ? FROM scores WHERE validation_state = 'unverified'
      ON CONFLICT(score_id) DO UPDATE SET state = 'queued', updated_at = excluded.updated_at,
        last_error = NULL, compute_version = excluded.compute_version`).run(now, REPLAY_COMPUTE_VERSION);
    database.prepare(`UPDATE scores SET validation_state = 'queued', score = NULL, accuracy = NULL
      WHERE validation_state = 'unverified'`).run();
    database.prepare("DELETE FROM server_state WHERE key = 'cache_version'").run();
    database.exec("COMMIT");
    return Number(result.changes);
  } catch (reason) {
    database.exec("ROLLBACK");
    throw reason;
  }
}

export function queueAllScoresForRecalculation(database: DatabaseSync): number {
  const now = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = database.prepare(`INSERT INTO validation_jobs
      (score_id, state, attempts, updated_at, last_error, compute_version)
      SELECT id, 'queued', 0, ?, NULL, ? FROM scores WHERE true
      ON CONFLICT(score_id) DO UPDATE SET state = 'queued', attempts = 0, updated_at = excluded.updated_at,
        last_error = NULL, compute_version = excluded.compute_version`).run(now, REPLAY_COMPUTE_VERSION);
    database.prepare(`UPDATE scores SET validation_state = 'queued', validation_error = NULL,
      score = NULL, accuracy = NULL, duration_seconds = 0`).run();
    database.exec(`
      DELETE FROM leaderboard_users;
      UPDATE users SET score_count = 0, total_score = 0, play_time_seconds = 0;
      INSERT OR REPLACE INTO server_state (key, value) VALUES ('cache_version', '2');
    `);
    database.exec("COMMIT");
    return Number(result.changes);
  } catch (reason) {
    database.exec("ROLLBACK");
    throw reason;
  }
}

export function requeueOutdatedValidationJobs(database: DatabaseSync): number {
  const result = database.prepare(`UPDATE validation_jobs SET state = 'queued', attempts = 0, updated_at = ?,
    last_error = NULL, compute_version = ? WHERE state = 'failed' AND compute_version < ?`)
    .run(new Date().toISOString(), REPLAY_COMPUTE_VERSION, REPLAY_COMPUTE_VERSION);
  database.prepare(`UPDATE scores SET validation_state = 'queued', validation_error = NULL WHERE id IN
    (SELECT score_id FROM validation_jobs WHERE state = 'queued' AND compute_version = ?)`).run(REPLAY_COMPUTE_VERSION);
  return Number(result.changes);
}
