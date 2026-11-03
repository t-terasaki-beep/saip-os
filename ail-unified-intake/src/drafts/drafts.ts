// 確認文案：生成 → 承認 → 送信。送信は3ゲートで必ずブロック。
//   ゲート順: ①未承認 → ②全体OFF(ALLOW_OUTBOUND_SEND) → ③口座OFF(outbound_enabled)
import { db, now } from "../db.js";
import { id } from "../util/id.js";
import { config } from "../config.js";
import { outboundBlockedReason } from "../channels/accounts.js";

export function generateDraft(taskId: string, actor: string): { id: string; body: string } {
  const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(taskId) as any;
  const client = task?.client_id
    ? (db.prepare("SELECT name FROM clients WHERE id=?").get(task.client_id) as any)
    : null;
  let missing: string[] = [];
  try { missing = JSON.parse(task?.missing_info || "[]"); } catch {}

  const lines: string[] = [];
  lines.push(`${client?.name ?? "ご担当者"}様`);
  lines.push("いつもお世話になっております。");
  lines.push("ご依頼ありがとうございます。進めるにあたり、以下の点をご確認させてください。");
  if (missing.length) for (const m of missing) lines.push(`・${m}`);
  else lines.push("・ご依頼内容に相違ないか、念のためご確認ください。");
  lines.push("お手数をおかけしますが、よろしくお願いいたします。");
  const body = lines.join("\n");

  const t = now();
  const did = id("drf");
  db.prepare(
    "INSERT INTO confirmation_drafts (id, task_id, body, status, created_by, created_at) VALUES (?,?,?, 'pending', ?, ?)"
  ).run(did, taskId, body, actor, t);
  db.prepare("INSERT INTO audit_log (id, task_id, actor, action, detail, created_at) VALUES (?,?,?,?,?,?)")
    .run(id("aud"), taskId, actor, "draft_generate", did, t);
  return { id: did, body };
}

export function approveDraft(draftId: string, actor: string): { ok: boolean; error?: string } {
  const d = db.prepare("SELECT status FROM confirmation_drafts WHERE id=?").get(draftId) as any;
  if (!d) return { ok: false, error: "文案なし" };
  if (d.status !== "pending") return { ok: false, error: "pending以外は承認できません" };
  db.prepare("UPDATE confirmation_drafts SET status='approved', approved_by=?, approved_at=? WHERE id=?")
    .run(actor, now(), draftId);
  return { ok: true };
}

export function sendDraft(draftId: string, actor: string): { ok: boolean; error?: string } {
  const d = db.prepare("SELECT * FROM confirmation_drafts WHERE id=?").get(draftId) as any;
  if (!d) return { ok: false, error: "文案なし" };

  // ① 未承認ゲート
  if (d.status !== "approved") return { ok: false, error: "未承認のため送信できません" };

  // ② 全体OFFゲート
  if (!config.allowOutboundSend) {
    return { ok: false, error: "送信は全体OFF（ALLOW_OUTBOUND_SEND=false）のため送信しません" };
  }

  // ③ 口座OFFゲート
  const task = db.prepare("SELECT client_id, channel FROM tasks WHERE id=?").get(d.task_id) as any;
  const blocked = outboundBlockedReason(task?.client_id ?? null, task?.channel ?? "");
  if (blocked) return { ok: false, error: `口座ゲートでブロック: ${blocked}` };

  // 3ゲート通過 → 送信済みに（実送信の配線は口座有効化後に接続）
  const t = now();
  db.prepare("UPDATE confirmation_drafts SET status='sent', sent_at=? WHERE id=?").run(t, draftId);
  db.prepare("INSERT INTO audit_log (id, task_id, actor, action, detail, created_at) VALUES (?,?,?,?,?,?)")
    .run(id("aud"), d.task_id, actor, "draft_send", draftId, t);
  return { ok: true };
}
