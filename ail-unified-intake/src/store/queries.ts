// 画面・API用の読み取りクエリ。
import { db } from "../db.js";
import type { Scope } from "../auth/rbac.js";
import { suggestCandidates } from "../assign/assign.js";
import { CATEGORY_LABEL, type OnlineSecretaryTaskCategory } from "../online_secretary/category.js";

export interface InboxRow {
  id: string; title: string | null; category: string | null; category_label: string | null;
  status: string; priority: string | null; client_name: string | null;
  assignee_name: string | null; deadline_at: number | null; estimate_min: number | null; created_at: number;
}

const INBOX_SELECT = `
  SELECT t.id, t.title, t.category, t.status, t.priority, t.deadline_at, t.estimate_min, t.created_at,
         c.name AS client_name, s.name AS assignee_name
  FROM tasks t
  LEFT JOIN clients c ON c.id = t.client_id
  LEFT JOIN staff   s ON s.id = t.assignee_id`;

function decorate(r: any): InboxRow {
  return { ...r, category_label: r.category ? (CATEGORY_LABEL[r.category as OnlineSecretaryTaskCategory] ?? r.category) : null };
}

export function listInboxScoped(scope: Scope): InboxRow[] {
  const rows = db.prepare(`${INBOX_SELECT} WHERE ${scope.clause} ORDER BY t.created_at DESC LIMIT 200`)
    .all(...scope.params) as any[];
  return rows.map(decorate);
}

export interface TaskDetail {
  task: any;
  client_notes: string | null;     // clients.operational_notes（⚠注意事項）
  outbound_enabled: number;        // タスクのチャネル口座の送信可否（表示用）
  suggested: ReturnType<typeof suggestCandidates>;
  missing_info: string[];
  time_total: number;
  drafts: any[];
}

export function taskDetail(taskId: string): TaskDetail | null {
  const task = db.prepare(`
    SELECT t.*, c.name AS client_name, s.name AS assignee_name
    FROM tasks t
    LEFT JOIN clients c ON c.id = t.client_id
    LEFT JOIN staff   s ON s.id = t.assignee_id
    WHERE t.id = ?`).get(taskId) as any;
  if (!task) return null;

  const notesRow = task.client_id
    ? (db.prepare("SELECT operational_notes FROM clients WHERE id=?").get(task.client_id) as any)
    : null;

  const idfRow = task.client_id
    ? (db.prepare("SELECT outbound_enabled FROM client_identifiers WHERE client_id=? AND channel=? LIMIT 1")
        .get(task.client_id, task.channel) as any)
    : null;

  let missing: string[] = [];
  try { missing = JSON.parse(task.missing_info || "[]"); } catch {}

  const time_total = (db.prepare("SELECT COALESCE(SUM(minutes),0) s FROM time_entries WHERE task_id=?").get(taskId) as any).s;
  const drafts = db.prepare("SELECT id, status, body, created_at FROM confirmation_drafts WHERE task_id=? ORDER BY created_at DESC").all(taskId);

  return {
    task,
    client_notes: notesRow?.operational_notes ?? null,
    outbound_enabled: idfRow?.outbound_enabled ?? 0,
    suggested: suggestCandidates(taskId),
    missing_info: missing,
    time_total,
    drafts,
  };
}
