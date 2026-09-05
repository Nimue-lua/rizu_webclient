import { backup, DatabaseSync } from "node:sqlite";

const [, , databasePath, backupPath] = process.argv;
if (!databasePath || !backupPath) throw new Error("Usage: backup-database.mjs <database> <backup>");

const source = new DatabaseSync(databasePath);
await backup(source, backupPath);
source.close();

const copy = new DatabaseSync(backupPath, { readOnly: true });
const check = copy.prepare("PRAGMA quick_check").get();
copy.close();
if (check.quick_check !== "ok") throw new Error(`Database backup failed: ${check.quick_check}`);
console.log(`Database backup: ${backupPath}`);
