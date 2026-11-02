// 担当候補の提示（根拠つき）と、手動割当。割当通知は外部送信OFF時は記録のみ。
import { db, now } from "../db.js";
import { id } from "../util/id.js";
import type { OnlineSecretaryTaskCategory } from "../online_secretary/category.js";

const RELATED_SKILLS: Record<OnlineSecretaryTaskCategory, string[]> = {
  quotation_invoice: ["見積", "請求書"],
  payment_followup: ["入金確認", "請求書"],
  accounting_entry: ["経費入力", "記帳"],
  attendance_payroll_prep: ["勤怠", "給与"],
  executive_operations: ["資料作成", "日程調整"],
  other: [],
};

export interface Candidate { staff_id: string; staff_name: string; score: number; reason: string; }

export function suggestCandidates(taskId: string, limit = 3): Candidate[] {
  const task = db.prepare("SELECT category, task_type FROM tasks WHERE id=?").get(taskId) as
    | { category: OnlineSecretaryTaskCategory | null; task_type: string | null }
    | undefined;
  if (!task) return [];
  const want = new Set<string>();
  if (task.task_type) want.add(task.task_type);
  for (const s of RELATED_SKILLS[(task.category ?? "other") as OnlineSecretaryTaskCategory] ?? []) want.add(s);

  const staff = db.prepare("SELECT * FROM staff WHERE active=1").all() as any[];
  const scored: Candidate[] = [];
  for (const s of staff) {
    let skills: string[] = [];
    try { skills = JSON.parse(s.skills || "[]"); } catch {}
    const hits = skills.filter((sk) => want.has(sk));
    const score = hits.length * 10 + Math.round((s.weekly_capacity_min || 0) / 600);
    const reason = hits.length ? `得意: ${hits.join("・")}` : "手すき（スキル一致なし）";
    scored.push({ staff_id: s.id, staff_name: s.name, score: hits.length ? score : score - 100, reason });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function assignTask(taskId: string, staffId: string, actor: string): { ok: boolean; error?: string } {
  const task = db.prepare("SELECT id FROM tasks WHERE id=?").get(taskId);
  if (!task) return { ok: false, error: "タスクなし" };
  const staff = db.prepare("SELECT id, name, notify_channel FROM staff WHERE id=?").get(staffId) as any;
  if (!staff) return { ok: false, error: "スタッフなし" };

  const t = now();
  db.prepare("UPDATE tasks SET assignee_id=?, status='assigned', updated_at=? WHERE id=?").run(staffId, t, taskId);

  // 割当通知：外部送信は配線しない（記録のみ）。実送信は別途・承認後。
  db.prepare(
    "INSERT INTO notifications (id, task_id, to_staff_id, channel, body, status, created_at) VALUES (?,?,?,?,?, 'recorded', ?)"
  ).run(id("ntf"), taskId, staffId, staff.notify_channel ?? null, `担当割当: ${staff.name}`, t);

  db.prepare("INSERT INTO audit_log (id, task_id, actor, action, detail, created_at) VALUES (?,?,?,?,?,?)")
    .run(id("aud"), taskId, actor, "assign", `assignee=${staffId}`, t);

  return { ok: true };
}
