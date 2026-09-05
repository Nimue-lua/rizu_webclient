import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 3;
const STALE_JOB_SECONDS = 10 * 60;

function columns(database: DatabaseSync, table: string): Set<string> {
  return new Set((database.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map(({ name }) => name));
}

function addColumn(database: DatabaseSync, table: string, known: Set<string>, definition: string): void {
  const name = definition.split(/\s+/, 1)[0];
  if (!known.has(name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export function openReplayDatabase(database_path: string): DatabaseSync {
  const database = new DatabaseSync(database_path);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;");
  const schema_version = (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (schema_version > SCHEMA_VERSION) {
    database.close();
    throw new Error(`Replay database schema ${schema_version} is newer than supported schema ${SCHEMA_VERSION}`);
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY, chart_md5 TEXT NOT NULL CHECK(length(chart_md5) = 32),
        chart_index INTEGER NOT NULL CHECK(chart_index >= 1), user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        mode TEXT NOT NULL, accuracy REAL, score REAL, played_at TEXT NOT NULL, submitted_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL, replay BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS presence (
        client_id TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, last_seen INTEGER NOT NULL
      );
    `);
    const user_columns = columns(database, "users");
    addColumn(database, "users", user_columns, "score_count INTEGER NOT NULL DEFAULT 0");
    addColumn(database, "users", user_columns, "total_score REAL NOT NULL DEFAULT 0");
    addColumn(database, "users", user_columns, "play_time_seconds REAL NOT NULL DEFAULT 0");
    const score_columns = columns(database, "scores");
    addColumn(database, "scores", score_columns, "comment TEXT");
    addColumn(database, "scores", score_columns, "duration_seconds REAL NOT NULL DEFAULT 0");
    addColumn(database, "scores", score_columns, "validation_state TEXT NOT NULL DEFAULT 'queued'");
    addColumn(database, "scores", score_columns, "validation_error TEXT");
    if (!score_columns.has("validation_state")) database.exec("UPDATE scores SET validation_state = 'unverified'");
    database.exec(`
      CREATE TABLE IF NOT EXISTS leaderboards (
        id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        mode TEXT, keys INTEGER, sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS leaderboard_skill_plays (
        leaderboard_id INTEGER NOT NULL REFERENCES leaderboards(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        chart_md5 TEXT NOT NULL, chart_index INTEGER NOT NULL, skill TEXT NOT NULL,
        rating REAL NOT NULL, score_id INTEGER NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
        PRIMARY KEY (leaderboard_id, user_id, chart_md5, chart_index, skill)
      );
      CREATE TABLE IF NOT EXISTS leaderboard_chart_plays (
        leaderboard_id INTEGER NOT NULL REFERENCES leaderboards(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        chart_md5 TEXT NOT NULL, chart_index INTEGER NOT NULL, rating REAL NOT NULL,
        accuracy REAL NOT NULL, score_id INTEGER NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
        PRIMARY KEY (leaderboard_id, user_id, chart_md5, chart_index)
      );
      CREATE TABLE IF NOT EXISTS leaderboard_users (
        leaderboard_id INTEGER NOT NULL REFERENCES leaderboards(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        speed REAL NOT NULL DEFAULT 0, speed_count INTEGER NOT NULL DEFAULT 0,
        dexterity REAL NOT NULL DEFAULT 0, dexterity_count INTEGER NOT NULL DEFAULT 0,
        stamina REAL NOT NULL DEFAULT 0, stamina_count INTEGER NOT NULL DEFAULT 0,
        technical REAL NOT NULL DEFAULT 0, technical_count INTEGER NOT NULL DEFAULT 0,
        accuracy REAL, updated_at TEXT NOT NULL,
        PRIMARY KEY (leaderboard_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS validation_jobs (
        score_id INTEGER PRIMARY KEY REFERENCES scores(id) ON DELETE CASCADE,
        state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL, last_error TEXT, compute_version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS server_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS score_days (day TEXT PRIMARY KEY, score_count INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS scores_chart_ranking_idx ON scores(chart_md5, chart_index, accuracy DESC, score DESC, id ASC);
      CREATE INDEX IF NOT EXISTS scores_recent_idx ON scores(id DESC);
      CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS presence_last_seen_idx ON presence(last_seen);
      CREATE INDEX IF NOT EXISTS leaderboard_users_skill_idx ON leaderboard_users(leaderboard_id, speed DESC);
      INSERT OR IGNORE INTO leaderboards (slug, name, mode, keys, sort_order) VALUES
        ('all', 'All modes', NULL, NULL, 0), ('osu', 'osu!standard', 'osu', NULL, 10),
        ('mania-4k', '4K', 'mania', 4, 20), ('mania-7k', '7K', 'mania', 7, 30),
        ('mania-10k', '10K', 'mania', 10, 40), ('mania-other', 'Other key modes', 'mania', -1, 50);
      INSERT OR IGNORE INTO server_state (key, value) SELECT 'total_scores', CAST(COUNT(*) AS TEXT) FROM scores;
      INSERT OR IGNORE INTO score_days (day, score_count)
        SELECT DATE(submitted_at), COUNT(*) FROM scores GROUP BY DATE(submitted_at);
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
    const job_columns = columns(database, "validation_jobs");
    addColumn(database, "validation_jobs", job_columns, "compute_version INTEGER NOT NULL DEFAULT 1");
    database.prepare(`UPDATE validation_jobs SET state = 'queued' WHERE state = 'running'
      AND updated_at < ?`).run(new Date(Date.now() - STALE_JOB_SECONDS * 1000).toISOString());
    database.exec("COMMIT");
  } catch (reason) {
    database.exec("ROLLBACK");
    database.close();
    throw reason;
  }
  return database;
}
