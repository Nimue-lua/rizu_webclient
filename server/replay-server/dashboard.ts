import type { DatabaseSync } from "node:sqlite";

function escape(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] as string);
}

function table(title: string, rows: Record<string, unknown>[]): string {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return `<section><h2>${escape(title)}</h2><div class="table"><table><thead><tr>${columns.map((column) => `<th>${escape(column)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escape(row[column])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${rows.length ? "" : "<p>No rows</p>"}</section>`;
}

export function dashboardHtml(database: DatabaseSync): string {
  const users = database.prepare(`SELECT id, name, created_at, score_count, ROUND(total_score) AS total_score,
    ROUND(play_time_seconds, 1) AS play_time_seconds FROM users ORDER BY id DESC LIMIT 100`).all() as Record<string, unknown>[];
  const scores = database.prepare(`SELECT id, chart_md5, chart_index, user_id, mode, score, ROUND(accuracy, 6) AS accuracy,
    ROUND(duration_seconds, 1) AS duration_seconds, validation_state, submitted_at FROM scores ORDER BY id DESC LIMIT 100`).all() as Record<string, unknown>[];
  const leaderboards = database.prepare(`SELECT leaderboards.slug, leaderboards.name, leaderboards.mode, leaderboards.keys,
    COUNT(leaderboard_users.user_id) AS players FROM leaderboards LEFT JOIN leaderboard_users ON leaderboard_users.leaderboard_id = leaderboards.id
    GROUP BY leaderboards.id ORDER BY leaderboards.sort_order`).all() as Record<string, unknown>[];
  const jobs = database.prepare("SELECT score_id, state, attempts, updated_at, last_error FROM validation_jobs ORDER BY score_id DESC LIMIT 100").all() as Record<string, unknown>[];
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Rizu server</title><style>
    :root{color-scheme:dark;background:#111;color:#e8e4da;font:14px ui-monospace,SFMono-Regular,Consolas,monospace}body{margin:0;padding:28px}header{border-bottom:1px solid #514d43;margin-bottom:28px}h1{font-size:24px}h2{color:#e8b85f;font-size:15px;text-transform:uppercase;letter-spacing:.12em}section{margin:28px 0}.table{overflow:auto;border:1px solid #3c3933}table{border-collapse:collapse;width:100%}th,td{padding:8px 10px;text-align:left;border-bottom:1px solid #302e2a;white-space:nowrap}th{background:#211f1b;color:#aaa49a}tr:hover td{background:#191815}a{color:#e8b85f}@media(max-width:600px){body{padding:14px}}
  </style></head><body><header><h1>Rizu replay server</h1><p>Public, read-only database overview. Credentials, sessions, replay bytes and metadata are not exposed.</p></header>
  ${table("Users", users)}${table("Recent scores", scores)}${table("Leaderboards", leaderboards)}${table("Replay validation", jobs)}</body></html>`;
}
