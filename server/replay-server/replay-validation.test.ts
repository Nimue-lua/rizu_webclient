import assert from "node:assert/strict";
import { test } from "node:test";
import { openReplayDatabase } from "./database.ts";
import { queueAllScoresForRecalculation } from "./replay-validation.ts";
import { REPLAY_COMPUTE_VERSION } from "./replay-verifier.ts";

test("queues every score for recalculation and resets derived data", () => {
  const database = openReplayDatabase(":memory:");
  try {
    database.exec(`
      INSERT INTO users (id, name, password_hash, created_at, score_count, total_score, play_time_seconds)
        VALUES (1, 'Player', 'hash', '2026-01-01', 2, 3000, 240);
      INSERT INTO scores (id, chart_md5, chart_index, user_id, mode, accuracy, score, played_at, submitted_at,
        metadata_json, replay, duration_seconds, validation_state, validation_error) VALUES
        (1, '11111111111111111111111111111111', 1, 1, 'mania', 0.9, 1000, '2026-01-01', '2026-01-01', '{}', X'00', 120, 'valid', NULL),
        (2, '22222222222222222222222222222222', 1, 1, 'mania', NULL, NULL, '2026-01-01', '2026-01-01', '{}', X'00', 0, 'invalid', 'old failure'),
        (3, '33333333333333333333333333333333', 1, NULL, 'osu', 0.8, 2000, '2026-01-01', '2026-01-01', '{}', X'00', 120, 'unverified', NULL);
      INSERT INTO validation_jobs (score_id, state, attempts, updated_at, last_error, compute_version)
        VALUES (1, 'succeeded', 1, '2026-01-01', NULL, 1), (2, 'failed', 3, '2026-01-01', 'old failure', 1);
      INSERT INTO leaderboard_users (leaderboard_id, user_id, updated_at) VALUES (1, 1, '2026-01-01');
    `);

    assert.equal(queueAllScoresForRecalculation(database), 3);
    assert.deepEqual(Array.from(database.prepare(`SELECT id, score, accuracy, duration_seconds, validation_state, validation_error
      FROM scores ORDER BY id`).all(), (row) => ({ ...row })), [
      { id: 1, score: null, accuracy: null, duration_seconds: 0, validation_state: "queued", validation_error: null },
      { id: 2, score: null, accuracy: null, duration_seconds: 0, validation_state: "queued", validation_error: null },
      { id: 3, score: null, accuracy: null, duration_seconds: 0, validation_state: "queued", validation_error: null },
    ]);
    assert.deepEqual(Array.from(database.prepare(`SELECT score_id, state, attempts, last_error, compute_version
      FROM validation_jobs ORDER BY score_id`).all(), (row) => ({ ...row })), [
      { score_id: 1, state: "queued", attempts: 0, last_error: null, compute_version: REPLAY_COMPUTE_VERSION },
      { score_id: 2, state: "queued", attempts: 0, last_error: null, compute_version: REPLAY_COMPUTE_VERSION },
      { score_id: 3, state: "queued", attempts: 0, last_error: null, compute_version: REPLAY_COMPUTE_VERSION },
    ]);
    assert.deepEqual({ ...database.prepare("SELECT score_count, total_score, play_time_seconds FROM users WHERE id = 1").get() },
      { score_count: 0, total_score: 0, play_time_seconds: 0 });
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM leaderboard_users").get() as { count: number }).count, 0);
    assert.equal(queueAllScoresForRecalculation(database), 3);
  } finally {
    database.close();
  }
});
