// 運用メトリクス。品質評価・速度評価は実装しない（実測が貯まってから定義）。
// ここでは「自動化率・人手編集率・レビュー率」など、実測可能な素の数だけを返す。
import { db } from "../db.js";

export function metrics(): {
  total: number;
  analyzed: number;
  assigned: number;
  done: number;
  automation_rate: number | null;
  human_edit_rate: number;
  review_rate: number;
} {
  const total = (db.prepare("SELECT COUNT(*) n FROM tasks").get() as any).n;
  const analyzed = (db.prepare("SELECT COUNT(*) n FROM tasks WHERE category IS NOT NULL").get() as any).n;
  const assigned = (db.prepare("SELECT COUNT(*) n FROM tasks WHERE assignee_id IS NOT NULL").get() as any).n;
  const done = (db.prepare("SELECT COUNT(*) n FROM tasks WHERE status='done'").get() as any).n;

  // 自動化率＝解析まで自動で到達した割合（人が触る前の工程の自動化度合いの目安）
  const automation_rate = total ? analyzed / total : null;
  // 確認文案を要した割合（不足情報があり人の確認が要った割合の目安）
  const needConfirm = (db.prepare("SELECT COUNT(DISTINCT task_id) n FROM confirmation_drafts").get() as any).n;
  const human_edit_rate = analyzed ? needConfirm / analyzed : 0;
  const review_rate = analyzed ? needConfirm / analyzed : 0;

  return { total, analyzed, assigned, done, automation_rate, human_edit_rate, review_rate };
}
