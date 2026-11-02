import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DBP = `./data/test3-${Date.now()}.db`;
process.env.DATABASE_PATH = DBP;
process.env.AI_PROVIDER = "mock";
process.env.NODE_ENV = "test";

const { db, migrate } = await import("../src/db.js");
migrate();

db.exec(`
  INSERT INTO clients (id, company, name, manager_id, created_at) VALUES ('cli_a','A','A商事','stf_mgr',0);
  INSERT INTO client_identifiers (id, client_id, channel, identifier) VALUES ('idf','cli_a','chatwork','cw-user');
  INSERT INTO staff (id,name,role,skills,weekly_capacity_min,notify_channel,active,created_at) VALUES
    ('stf_mgr','高市','manager','["資料作成","請求書","見積"]',2400,'chatwork:room:9',1,0),
    ('stf_tanaka','田中','staff','["請求書"]',1800,'email:tanaka@x',1,0);
  INSERT INTO users (id,email,name,role,staff_id,token,active,created_at) VALUES
    ('u_adm','a@x','管理者','admin',NULL,'tok-admin',1,0),
    ('u_mgr','m@x','高市','manager','stf_mgr','tok-mgr',1,0),
    ('u_stf','t@x','田中','staff','stf_tanaka','tok-staff',1,0);
  INSERT INTO task_templates (id,task_type,default_minutes) VALUES ('t1','請求書',120),('t2','資料作成',150);
`);

const { ingest } = await import("../src/ingest/pipeline.js");
const { processAll } = await import("../src/jobs/worker.js");
const { assignTask } = await import("../src/assign/assign.js");
const { generateDraft, approveDraft, sendDraft } = await import("../src/drafts/drafts.js");
const { metrics } = await import("../src/metrics/metrics.js");
const { scopeWhere, userByToken, requireRole } = await import("../src/auth/rbac.js");
const { listInboxScoped } = await import("../src/store/queries.js");
const { config } = await import("../src/config.js");
const { setAccountFlags } = await import("../src/channels/accounts.js");

const getTask = (id: string) => db.prepare("SELECT * FROM tasks WHERE id=?").get(id) as any;
let seq = 0;
function cw(body: string) {
  seq++;
  return { channel: "chatwork" as const, externalId: `m3-${seq}`, threadKey: `r3-${seq}`,
    sourceUrl: "u", senderRaw: "cw-user", bodyRaw: body, receivedAt: 1720000000000 + seq };
}
async function newTask(body: string) {
  const o = ingest(cw(body));
  await processAll();
  return o.taskId!;
}

test("1. 担当確定 → assignee/status/通知/監査", async () => {
  const id = await newTask("資料を作成してください。用途は研修、PPTで。");
  const r = assignTask(id, "stf_tanaka", "高市");
  assert.equal(r.ok, true);
  const t = getTask(id);
  assert.equal(t.assignee_id, "stf_tanaka");
  assert.equal(t.status, "assigned");
  const notif = db.prepare("SELECT * FROM notifications WHERE task_id=?").get(id) as any;
  assert.equal(notif.to_staff_id, "stf_tanaka");
  assert.equal(notif.status, "recorded"); // ALLOW_OUTBOUND_SEND=false → 送らず記録
  const a = db.prepare("SELECT * FROM audit_log WHERE task_id=? AND action='assign'").get(id);
  assert.ok(a);
});

test("2. RBAC scope: staff は自分の担当のみ見える", async () => {
  const id = await newTask("資料作成 用途は社内向け");
  assignTask(id, "stf_tanaka", "高市");
  const staffView = listInboxScoped(scopeWhere({ userId: "u_stf", role: "staff", staffId: "stf_tanaka", name: "田中" }));
  assert.ok(staffView.some((r) => r.id === id));
  const otherStaff = listInboxScoped(scopeWhere({ userId: "x", role: "staff", staffId: "stf_none", name: "他" }));
  assert.ok(!otherStaff.some((r) => r.id === id));
});

test("3. RBAC scope: manager は担当マネージャーの案件が見える", async () => {
  const id = await newTask("資料作成 用途は営業");
  const mgrView = listInboxScoped(scopeWhere({ userId: "u_mgr", role: "manager", staffId: "stf_mgr", name: "高市" }));
  assert.ok(mgrView.some((r) => r.id === id)); // manager_id=stf_mgr
});

test("4. RBAC scope: admin は全件", async () => {
  const all = listInboxScoped(scopeWhere({ userId: "u_adm", role: "admin", staffId: null, name: "管理者" }));
  const total = (db.prepare("SELECT COUNT(*) n FROM tasks").get() as any).n;
  assert.equal(all.length, Math.min(total, 200));
});

test("5. userByToken でロール解決", () => {
  const v = userByToken("tok-mgr");
  assert.equal(v?.role, "manager");
  assert.equal(v?.staffId, "stf_mgr");
  assert.equal(userByToken("bad"), null);
});

test("6. requireRole: 権限外は403", () => {
  let code = 0;
  const res: any = { status(c: number) { code = c; return this; }, json() { return this; } };
  let nextCalled = false;
  requireRole("manager", "admin")({ viewer: { role: "staff" } } as any, res, () => { nextCalled = true; });
  assert.equal(code, 403);
  assert.equal(nextCalled, false);
});

test("7. 確認文案: 生成→承認→送信ゲート（3ゲート）", async () => {
  const id = await newTask("請求書お願いします");
  const d = generateDraft(id, "高市");
  assert.ok(d.body.includes("ご確認させてください"));
  // 未承認では送れない
  assert.equal(sendDraft(d.id, "高市").ok, false);
  // 承認
  assert.equal(approveDraft(d.id, "高市").ok, true);
  // 承認済みでも ALLOW_OUTBOUND_SEND=false なら送らない
  const blocked = sendDraft(d.id, "高市");
  assert.equal(blocked.ok, false);
  assert.match(blocked.error!, /ALLOW_OUTBOUND_SEND/);
  // 送信を明示許可（全体ON＋口座ON）すると送信済みに
  config.allowOutboundSend = true;
  setAccountFlags("chatwork", "cw-user", { outbound: true });
  const sent = sendDraft(d.id, "高市");
  assert.equal(sent.ok, true);
  assert.equal((db.prepare("SELECT status FROM confirmation_drafts WHERE id=?").get(d.id) as any).status, "sent");
  config.allowOutboundSend = false;
  setAccountFlags("chatwork", "cw-user", { outbound: false });
});

test("8. 二重承認は不可", async () => {
  const id = await newTask("請求書お願いします 宛名だけ");
  const d = generateDraft(id, "高市");
  approveDraft(d.id, "高市");
  assert.equal(approveDraft(d.id, "高市").ok, false);
});

test("9. メトリクス（自動化率など）", () => {
  const m = metrics();
  assert.ok(m.analyzed > 0);
  assert.ok(m.automation_rate! >= 0 && m.automation_rate! <= 1);
  assert.ok("human_edit_rate" in m && "review_rate" in m);
});

test("10. 添付AI同意フラグ（既定OFF→ON）", async () => {
  const id = await newTask("資料作成 用途は共有");
  assert.equal(getTask(id).attachment_ai_consent, 0);
  db.prepare("UPDATE tasks SET attachment_ai_consent=1 WHERE id=?").run(id);
  assert.equal(getTask(id).attachment_ai_consent, 1);
});

test("cleanup", () => {
  db.close();
  for (const s of ["", "-wal", "-shm"]) { try { rmSync(DBP + s); } catch {} }
});
