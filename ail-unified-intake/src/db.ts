// SQLite 接続とマイグレーション実行。
//   マイグレーションは db/migrations/*.sql を名前順に適用し、schema_migrations で冪等管理。
import Database from "better-sqlite3";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DB_PATH = process.env.DATABASE_PATH || "./data/intake.db";
try { mkdirSync(dirname(DB_PATH), { recursive: true }); } catch {}

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const MIG_DIR = fileURLToPath(new URL("../db/migrations", import.meta.url));

export function migrate(): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);`);
  const applied = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map((r) => r.name)
  );
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  const mark = db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)");
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(`${MIG_DIR}/${f}`, "utf8");
    const tx = db.transaction(() => {
      db.exec(sql);
      mark.run(f, Date.now());
    });
    tx();
    ran.push(f);
  }
  return ran;
}

export function now(): number { return Date.now(); }

// `npm run migrate`
if (process.argv.includes("--migrate")) {
  const ran = migrate();
  console.log(ran.length ? `applied: ${ran.join(", ")}` : "no pending migrations");
}
