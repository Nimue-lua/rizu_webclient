import type { DatabaseSync } from "node:sqlite";
import type { ReplayValidationResult, ReplayValidator } from "./types.ts";
import { catalogChart } from "./catalog.ts";
import { cacheScoreRanking } from "./rankings.ts";

interface JobRow {
  score_id: number; user_id: number | null; chart_md5: string; chart_index: number; mode: "mania" | "osu";
  replay: Uint8Array; metadata_json: string; duration_seconds: number;
}

function finiteResult(result: ReplayValidationResult): boolean {
  return Number.isFinite(result.accuracy) && result.accuracy >= 0 && result.accuracy <= 1 &&
    (result.score === null || Number.isFinite(result.score));
}

export async function processValidationJobs(database: DatabaseSync, catalog: DatabaseSync,
  validator: ReplayValidator, limit = 100): Promise<{ valid: number; invalid: number }> {
  const jobs = database.prepare(`
    SELECT scores.id AS score_id, scores.user_id, scores.chart_md5, scores.chart_index, scores.mode,
      scores.replay, scores.metadata_json, scores.duration_seconds
    FROM validation_jobs JOIN scores ON scores.id = validation_jobs.score_id
    WHERE validation_jobs.state = 'queued' ORDER BY scores.id LIMIT ?
  `).all(limit) as unknown as JobRow[];
  let valid = 0;
  let invalid = 0;
  for (const job of jobs) {
    database.prepare("UPDATE validation_jobs SET state = 'running', attempts = attempts + 1, updated_at = ? WHERE score_id = ?")
      .run(new Date().toISOString(), job.score_id);
    try {
      const metadata = JSON.parse(job.metadata_json) as Record<string, unknown>;
      const result = await validator({ id: job.score_id, chart_md5: job.chart_md5, chart_index: job.chart_index,
        mode: job.mode, replay: job.replay, replay_base: metadata.replay_base });
      if (!finiteResult(result)) throw new Error("Validator returned an invalid score result");
      const next_metadata = { ...metadata, ...result };
      database.exec("BEGIN IMMEDIATE");
      try {
        database.prepare(`UPDATE scores SET score = ?, accuracy = ?, metadata_json = ?, validation_state = 'valid',
          validation_error = NULL WHERE id = ?`).run(result.score, result.accuracy, JSON.stringify(next_metadata), job.score_id);
        database.prepare("UPDATE validation_jobs SET state = 'succeeded', updated_at = ?, last_error = NULL WHERE score_id = ?")
          .run(new Date().toISOString(), job.score_id);
        if (job.user_id !== null) {
          database.prepare(`UPDATE users SET score_count = score_count + 1, total_score = total_score + ?,
            play_time_seconds = play_time_seconds + ? WHERE id = ?`)
            .run(result.score ?? 0, job.duration_seconds, job.user_id);
          const chart = catalogChart(catalog, job.chart_md5, job.chart_index);
          if (chart) cacheScoreRanking(database, job.score_id, job.user_id, job.chart_md5, job.chart_index, job.mode, result.accuracy, chart);
        }
        database.exec("COMMIT");
      } catch (reason) {
        database.exec("ROLLBACK");
        throw reason;
      }
      valid++;
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      database.prepare(`UPDATE scores SET validation_state = 'invalid', validation_error = ? WHERE id = ?`).run(error, job.score_id);
      database.prepare("UPDATE validation_jobs SET state = 'failed', updated_at = ?, last_error = ? WHERE score_id = ?")
        .run(new Date().toISOString(), error, job.score_id);
      invalid++;
    }
  }
  return { valid, invalid };
}
