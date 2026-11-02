// SQLiteベースの単純ジョブキュー。
import { db, now } from "../db.js";
import { id } from "../util/id.js";

export function enqueue(type: string, payload: unknown): string {
  const t = now();
  const jid = id("job");
  db.prepare(
    "INSERT INTO jobs (id, type, payload, status, attempts, created_at, updated_at) VALUES (?,?,?,'queued',0,?,?)"
  ).run(jid, type, JSON.stringify(payload ?? {}), t, t);
  return jid;
}

export interface Job { id: string; type: string; payload: any; attempts: number; }

export function claimNext(): Job | null {
  const row = db
    .prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1")
    .get() as any;
  if (!row) return null;
  db.prepare("UPDATE jobs SET status='running', attempts=attempts+1, updated_at=? WHERE id=?")
    .run(now(), row.id);
  return { id: row.id, type: row.type, payload: JSON.parse(row.payload || "{}"), attempts: row.attempts + 1 };
}

export function complete(jobId: string): void {
  db.prepare("UPDATE jobs SET status='done', updated_at=? WHERE id=?").run(now(), jobId);
}

export function fail(jobId: string, err: string): void {
  db.prepare("UPDATE jobs SET status='failed', last_error=?, updated_at=? WHERE id=?")
    .run(err.slice(0, 500), now(), jobId);
}
