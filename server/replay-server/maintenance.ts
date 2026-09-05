import { fileURLToPath } from "node:url";
import path from "node:path";
import { openReplayDatabase } from "./database.ts";
import { queueAllScoresForRecalculation } from "./replay-validation.ts";

export function scoreValidationCounts(database_path: string): Record<string, number> {
  const database = openReplayDatabase(database_path);
  try {
    const counts = database.prepare(`SELECT validation_state, COUNT(*) AS count FROM scores
      GROUP BY validation_state ORDER BY validation_state`).all() as unknown as { validation_state: string; count: number }[];
    return Object.fromEntries(counts.map(({ validation_state, count }) => [validation_state, count]));
  } finally {
    database.close();
  }
}

function usage(): void {
  console.error(`Usage: maintenance.ts <command>\n\nCommands:\n  scores\n  scores-recalculate --all`);
}

function main(): void {
  const database_path = process.env.RIZU_DATABASE ?? "/var/lib/rizu-replay/scores.sqlite3";
  const [command, confirmation, ...extra] = process.argv.slice(2);
  if (command === "scores" && confirmation === undefined) {
    const counts = scoreValidationCounts(database_path);
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    console.log(`total\t${total}`);
    for (const [state, count] of Object.entries(counts)) console.log(`${state}\t${count}`);
    return;
  }
  if (command === "scores-recalculate" && confirmation === "--all" && extra.length === 0) {
    const database = openReplayDatabase(database_path);
    try {
      const queued = queueAllScoresForRecalculation(database);
      console.log(`Queued ${queued} scores for recalculation.`);
    } finally {
      database.close();
    }
    return;
  }
  usage();
  process.exitCode = 2;
}

const is_main = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (is_main) main();
