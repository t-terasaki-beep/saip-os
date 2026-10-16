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
