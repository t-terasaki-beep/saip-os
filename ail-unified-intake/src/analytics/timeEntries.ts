// 実績時間の記録。15分単位のみ受け付ける（想定対実績差の集計に使う）。
import { db, now } from "../db.js";
import { id } from "../util/id.js";

export function addTimeEntry(
  taskId: string,
  staffId: string,
  minutes: number,
  note: string | null,
  createdBy: string
): { ok: boolean; totalActual?: number; error?: string } {
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes % 15 !== 0) {
    return { ok: false, error: "実績は15分単位で入力してください" };
  }
  const task = db.prepare("SELECT id, status FROM tasks WHERE id=?").get(taskId) as any;
  if (!task) return { ok: false, error: "タスクなし" };

  const t = now();
  db.prepare(
    "INSERT INTO time_entries (id, task_id, staff_id, minutes, note, created_by, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(id("te"), taskId, staffId, minutes, note, createdBy, t);

  if (task.status === "assigned") {
    db.prepare("UPDATE tasks SET status='in_progress', updated_at=? WHERE id=?").run(t, taskId);
  }

  const total = (db.prepare("SELECT COALESCE(SUM(minutes),0) s FROM time_entries WHERE task_id=?").get(taskId) as any).s;
  return { ok: true, totalActual: total };
}

export function completeTask(taskId: string, actor: string): { ok: boolean } {
  const r = db.prepare("UPDATE tasks SET status='done', updated_at=? WHERE id=?").run(now(), taskId);
  if (r.changes) {
    db.prepare("INSERT INTO audit_log (id, task_id, actor, action, detail, created_at) VALUES (?,?,?,?,?,?)")
      .run(id("aud"), taskId, actor, "complete", "", now());
  }
  return { ok: r.changes > 0 };
}
