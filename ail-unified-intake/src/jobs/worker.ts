// ジョブ処理ワーカー。analyze ジョブ＝AI解析してタスクを更新する。
import { db, now } from "../db.js";
import { id } from "../util/id.js";
import { claimNext, complete, fail, type Job } from "./queue.js";
import { getAnalyzer } from "../ai/index.js";

async function handleAnalyze(payload: { taskId: string }): Promise<void> {
  const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(payload.taskId) as any;
  if (!task) return;
  const a = await getAnalyzer().analyze({ body: task.body ?? "", receivedAt: task.created_at, channel: task.channel });

  const tpl = db.prepare("SELECT default_minutes FROM task_templates WHERE task_type=?").get(a.task_type) as
    | { default_minutes: number }
    | undefined;
  const estimate = tpl?.default_minutes ?? null;

  db.prepare(
    `UPDATE tasks SET title=?, category=?, task_type=?, priority=?, deadline_at=?, estimate_min=?,
       confidence=?, missing_info=?, status=CASE WHEN status='inbox' THEN 'analyzed' ELSE status END, updated_at=?
     WHERE id=?`
  ).run(
    a.title, a.category, a.task_type, a.priority, a.deadline_at, estimate,
    a.confidence, JSON.stringify(a.missing_info), now(), payload.taskId
  );

  db.prepare("INSERT INTO audit_log (id, task_id, actor, action, detail, created_at) VALUES (?,?,?,?,?,?)")
    .run(id("aud"), payload.taskId, "ai", "analyze", `category=${a.category} conf=${a.confidence}`, now());
}

async function run(job: Job): Promise<void> {
  if (job.type === "analyze") return handleAnalyze(job.payload);
  // 未知のジョブ型は完了扱い（捨てる）
}

// 1件だけ処理（テスト・CLI用）。処理したら true。
export async function processOnce(): Promise<boolean> {
  const job = claimNext();
  if (!job) return false;
  try {
    await run(job);
    complete(job.id);
  } catch (e) {
    fail(job.id, e instanceof Error ? e.message : String(e));
  }
  return true;
}

// キューが空になるまで処理。
export async function processAll(): Promise<number> {
  let n = 0;
  while (await processOnce()) n++;
  return n;
}

if (process.argv.includes("--once")) {
  const did = await processOnce();
  console.log(did ? "processed 1 job" : "no jobs");
}
