// 統合受付エンジン HTTPサーバ（API＋管理コンソール＋Webhook受信）。
import express from "express";
import type { Request, Response } from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { db, migrate } from "./db.js";
import { config } from "./config.js";
import { ingest } from "./ingest/pipeline.js";
import { processAll } from "./jobs/worker.js";
import { authn, requireRole, scopeWhere, type Viewer } from "./auth/rbac.js";
import { listInboxScoped, taskDetail } from "./store/queries.js";
import { assignTask, suggestCandidates } from "./assign/assign.js";
import { addTimeEntry, completeTask } from "./analytics/timeEntries.js";
import { generateDraft, approveDraft, sendDraft } from "./drafts/drafts.js";
import { metrics } from "./metrics/metrics.js";
import { setClientNotes, setAccountFlags } from "./channels/accounts.js";

migrate();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(authn);

const INBOX_HTML = fileURLToPath(new URL("./web/inbox.html", import.meta.url));

type Req = Request & { viewer?: Viewer };

app.get("/", (_req, res) => res.type("html").send(readFileSync(INBOX_HTML, "utf8")));
app.get("/healthz", (_req, res) => res.json({ ok: true, provider: config.aiProvider }));

// 受信Webhook（Chatwork想定）。チャネルがOFFなら受けない。
app.post("/webhooks/chatwork", async (req: Request, res: Response) => {
  if (!config.intake.chatworkEnabled) return res.status(403).json({ error: "chatwork ingest disabled" });
  const e = req.body?.webhook_event ?? {};
  if (!e.message_id || !e.body) return res.status(400).json({ error: "bad payload" });
  const out = ingest({
    channel: "chatwork",
    externalId: String(e.message_id),
    threadKey: e.room_id != null ? `room:${e.room_id}` : undefined,
    sourceUrl: e.room_id ? `https://www.chatwork.com/#!rid${e.room_id}` : undefined,
    senderRaw: e.account_id != null ? String(e.account_id) : undefined,
    bodyRaw: String(e.body),
    receivedAt: e.send_time ? Number(e.send_time) * 1000 : Date.now(),
  });
  await processAll();
  res.json(out);
});

// --- viewer 必須 ---
function needViewer(req: Req, res: Response): Viewer | null {
  if (!req.viewer) { res.status(401).json({ error: "unauthorized" }); return null; }
  return req.viewer;
}

app.get("/api/me", (req: Req, res) => {
  const v = needViewer(req, res); if (!v) return;
  res.json(v);
});

app.get("/api/inbox", (req: Req, res) => {
  const v = needViewer(req, res); if (!v) return;
  res.json(listInboxScoped(scopeWhere(v)));
});

app.get("/api/metrics", requireRole("manager", "admin"), (_req, res) => res.json(metrics()));

app.get("/api/tasks/:id", (req: Req, res) => {
  const v = needViewer(req, res); if (!v) return;
  const d = taskDetail(req.params.id);
  if (!d) return res.status(404).json({ error: "not found" });
  res.json(d);
});

app.get("/api/candidates/:taskId", (req: Req, res) => {
  const v = needViewer(req, res); if (!v) return;
  res.json(suggestCandidates(req.params.taskId));
});

app.post("/api/tasks/:id/assign", requireRole("manager", "admin"), (req: Req, res) => {
  const r = assignTask(req.params.id, req.body?.staff_id, req.viewer!.name);
  res.status(r.ok ? 200 : 400).json(r);
});

app.post("/api/tasks/:id/time", (req: Req, res) => {
  const v = needViewer(req, res); if (!v) return;
  const r = addTimeEntry(req.params.id, req.body?.staff_id ?? v.staffId, Number(req.body?.minutes), req.body?.note ?? null, v.name);
  res.status(r.ok ? 200 : 400).json(r);
});

app.post("/api/tasks/:id/complete", (req: Req, res) => {
  const v = needViewer(req, res); if (!v) return;
  res.json(completeTask(req.params.id, v.name));
});

app.post("/api/tasks/:id/draft", requireRole("manager", "admin"), (req: Req, res) => {
  res.json(generateDraft(req.params.id, req.viewer!.name));
});

app.post("/api/drafts/:id/approve", requireRole("manager", "admin"), (req: Req, res) => {
  const r = approveDraft(req.params.id, req.viewer!.name);
  res.status(r.ok ? 200 : 400).json(r);
});

app.post("/api/drafts/:id/send", requireRole("manager", "admin"), (req: Req, res) => {
  const r = sendDraft(req.params.id, req.viewer!.name);
  res.status(r.ok ? 200 : 400).json(r);
});

// 注意事項・口座フラグ（manager/admin）
app.post("/api/clients/:id/notes", requireRole("manager", "admin"), (req: Req, res) => {
  res.json(setClientNotes(req.params.id, req.body?.notes ?? null));
});

app.post("/api/channel-accounts/flags", requireRole("manager", "admin"), (req: Req, res) => {
  const { channel, identifier, inbound, outbound } = req.body ?? {};
  if (!channel || !identifier) return res.status(400).json({ error: "channel/identifier required" });
  res.json(setAccountFlags(channel, identifier, { inbound, outbound }));
});

// 期限超過の軽いチェック（記録のみ）
function overdueSweep(): void {
  const t = Date.now();
  const rows = db.prepare("SELECT id FROM tasks WHERE deadline_at IS NOT NULL AND deadline_at < ? AND status NOT IN ('done')").all(t) as any[];
  for (const r of rows) {
    const exists = db.prepare("SELECT 1 FROM audit_log WHERE task_id=? AND action='overdue'").get(r.id);
    if (!exists) db.prepare("INSERT INTO audit_log (id, task_id, actor, action, detail, created_at) VALUES (?,?,?,?,?,?)")
      .run(`aud_${t}_${r.id}`.slice(0, 40), r.id, "system", "overdue", "", t);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  setInterval(() => { processAll().catch(() => {}); }, 3000);
  setInterval(overdueSweep, Math.max(30, config.overdueCheckIntervalSec) * 1000);
  app.listen(config.port, () => {
    console.log(`ail-unified-intake listening on :${config.port} (AI=${config.aiProvider}, outbound=${config.allowOutboundSend ? "ON" : "OFF"})`);
  });
}

export { app };
