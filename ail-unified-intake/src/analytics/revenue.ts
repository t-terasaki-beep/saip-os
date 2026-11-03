// Phase 6D: 工数・収益の可視化。
//   想定対実績差（タスク単位）、スタッフ別工数、クライアント別収益（time課金＝実績分×時間単価）。
//   品質評価・速度評価は含めない（実測が貯まってから定義）。
import { db } from "../db.js";

export interface EstimateActualRow {
  task_id: string; title: string | null; category: string | null;
  estimate_min: number | null; actual_min: number; diff_min: number | null;
}

export function estimateVsActual(): { rows: EstimateActualRow[]; total_estimate: number; total_actual: number } {
  const rows = db.prepare(`
    SELECT t.id AS task_id, t.title, t.category, t.estimate_min,
           COALESCE((SELECT SUM(minutes) FROM time_entries te WHERE te.task_id=t.id),0) AS actual_min
    FROM tasks t
    WHERE EXISTS (SELECT 1 FROM time_entries te WHERE te.task_id=t.id)
    ORDER BY t.created_at DESC`).all() as any[];
  let te = 0, ta = 0;
  const out = rows.map((r) => {
    te += r.estimate_min ?? 0; ta += r.actual_min;
    return { ...r, diff_min: r.estimate_min == null ? null : r.actual_min - r.estimate_min };
  });
  return { rows: out, total_estimate: te, total_actual: ta };
}

export interface WorkloadRow { staff_id: string; staff_name: string; actual_min: number; tasks: number; }

export function workloadByStaff(): WorkloadRow[] {
  return db.prepare(`
    SELECT s.id AS staff_id, s.name AS staff_name,
           COALESCE(SUM(te.minutes),0) AS actual_min,
           COUNT(DISTINCT te.task_id) AS tasks
    FROM staff s
    LEFT JOIN time_entries te ON te.staff_id = s.id
    GROUP BY s.id ORDER BY actual_min DESC`).all() as any[];
}

export interface RevenueRow {
  client_id: string; client_name: string; billing_type: string;
  hourly_rate: number | null; actual_min: number; revenue: number | null; note: string;
}

export function revenueByClient(): { rows: RevenueRow[]; total_revenue: number } {
  const rows = db.prepare(`
    SELECT c.id AS client_id, c.name AS client_name, c.billing_type, c.hourly_rate,
           COALESCE(SUM(te.minutes),0) AS actual_min
    FROM clients c
    LEFT JOIN tasks t ON t.client_id = c.id
    LEFT JOIN time_entries te ON te.task_id = t.id
    GROUP BY c.id ORDER BY actual_min DESC`).all() as any[];
  let total = 0;
  const out: RevenueRow[] = rows.map((r) => {
    let revenue: number | null = null;
    let note = "";
    if (r.billing_type === "time") {
      if (r.hourly_rate == null) note = "要単価設定（hourly_rate 未設定）";
      else { revenue = Math.round((r.actual_min / 60) * r.hourly_rate); total += revenue; }
    } else {
      note = "固定課金（金額は依頼・契約のまま。当方で確定しない）";
    }
    return { client_id: r.client_id, client_name: r.client_name, billing_type: r.billing_type, hourly_rate: r.hourly_rate, actual_min: r.actual_min, revenue, note };
  });
  return { rows: out, total_revenue: total };
}
