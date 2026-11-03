// RBAC：Bearerトークン → ロール解決、ロール要求ミドルウェア、インボックスのスコープ。
import type { Request, Response, NextFunction } from "express";
import { db } from "../db.js";

export type Role = "admin" | "manager" | "staff";
export interface Viewer { userId: string; role: Role; staffId: string | null; name: string; }

export function userByToken(token: string | undefined | null): Viewer | null {
  if (!token) return null;
  const u = db.prepare("SELECT id, role, staff_id, name FROM users WHERE token=? AND active=1").get(token) as any;
  if (!u) return null;
  return { userId: u.id, role: u.role, staffId: u.staff_id ?? null, name: u.name ?? "" };
}

// Express: Authorization: Bearer <token> から viewer を復元（未認証なら viewer 無し）
export function authn(req: Request & { viewer?: Viewer }, _res: Response, next: NextFunction): void {
  const h = req.header("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : (req.header("x-token") || undefined);
  const v = userByToken(token);
  if (v) req.viewer = v;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request & { viewer?: Viewer }, res: Response, next: NextFunction): void => {
    const role = req.viewer?.role;
    if (!role || !roles.includes(role)) { res.status(403).json({ error: "forbidden" }); return; }
    next();
  };
}

export interface Scope { clause: string; params: any[]; }

// 列は tasks 別名 t. で修飾（JOIN先 clients にも manager_id があり曖昧になるため）。
export function scopeWhere(v: Viewer): Scope {
  if (v.role === "admin") return { clause: "1=1", params: [] };
  if (v.role === "manager") return { clause: "t.manager_id = ?", params: [v.staffId] };
  return { clause: "t.assignee_id = ?", params: [v.staffId] };
}

// 個別タスクのスコープ検査。タスクが存在しなければ null、存在するがスコープ外なら false。
export function taskInScope(v: Viewer, taskId: string): boolean | null {
  const scope = scopeWhere(v);
  const row = db.prepare(`SELECT 1 FROM tasks t WHERE t.id = ? AND ${scope.clause}`).get(taskId, ...scope.params);
  if (row) return true;
  const exists = db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(taskId);
  return exists ? false : null;
}

// 書類（documents）のスコープ検査。書類→タスクの紐づきで判定。
export function documentInScope(v: Viewer, docId: string): boolean | null {
  const doc = db.prepare("SELECT task_id FROM documents WHERE id = ?").get(docId) as { task_id: string } | undefined;
  if (!doc) return null;
  return taskInScope(v, doc.task_id);
}
