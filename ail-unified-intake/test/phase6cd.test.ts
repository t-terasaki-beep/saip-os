import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DBP = `./data/test6cd-${Date.now()}.db`;
process.env.DATABASE_PATH = DBP;
process.env.AI_PROVIDER = "mock";
process.env.NODE_ENV = "test";

const { db, migrate } = await import("../src/db.js");
migrate();

db.exec(`
  INSERT INTO clients (id, company, name, manager_id, billing_type, hourly_rate, created_at) VALUES
    ('cli_t','T','T商事','stf_mgr','time',3000,0),
    ('cli_x','X','X社','stf_mgr','time',NULL,0),
    ('cli_f','F','F社','stf_mgr','fixed',NULL,0);
  INSERT INTO client_identifiers (id, client_id, channel, identifier, inbound_enabled, outbound_enabled) VALUES
    ('idf_t','cli_t','chatwork','cw-t',1,0);
  INSERT INTO staff (id,name,role,skills,weekly_capacity_min,notify_channel,active,created_at) VALUES
    ('stf_mgr','M','manager','["見積","請求書"]',2400,'log:m',1,0),
    ('stf_a','A','staff','["請求書"]',1800,'log:a',1,0);
  INSERT INTO task_templates (id,task_type,default_minutes) VALUES ('t','見積',90),('t2','請求書',120);
`);

const { ingest } = await import("../src/ingest/pipeline.js");
const { processAll } = await import("../src/jobs/worker.js");
const { addTimeEntry } = await import("../src/analytics/timeEntries.js");
const { generateDocument, getDocument, approveDocument, renderDocumentPdf, parseLineItems } = await import("../src/documents/documents.js");
const { estimateVsActual, workloadByStaff, revenueByClient } = await import("../src/analytics/revenue.js");
const { config } = await import("../src/config.js");

async function seedTask(body: string) {
  const o = ingest({ channel: "chatwork", externalId: `d-${Math.random()}`, senderRaw: "cw-t", bodyRaw: body, receivedAt: 0 });
  await processAll();
  return o.taskId!;
}

test("6C-1. 明細抽出：金額はAIが確定しない（TEXTで要確認）", () => {
  const items = parseLineItems("見積書お願いします。品目：コンサル、数量：2。");
  assert.equal(items[0].name, "コンサル");
  assert.equal(items[0].qty, "2");
  assert.match(items[0].amount_text, /要確認/); // 金額は確定しない
});

test("6C-2. 見積書ドラフト生成 → draft・明細つき", async () => {
  const id = await seedTask("見積書お願いします。品目：コンサル、数量：1。宛名：T商事");
  const doc = generateDocument(id, "quotation", "M");
  const d = getDocument(doc.id);
  assert.equal(d.type, "quotation");
  assert.equal(d.status, "draft");
  assert.ok(d.line_items.length >= 1);
  assert.match(d.total_text, /確定しない|要確認/); // 合計も確定しない
});

test("6C-3. 承認：draft→approved、二重承認は不可", async () => {
  const id = await seedTask("請求書お願いします 宛名T商事");
  const doc = generateDocument(id, "invoice", "M");
  assert.equal(approveDocument(doc.id, "承認者").ok, true);
  assert.equal(getDocument(doc.id).status, "approved");
  assert.equal(approveDocument(doc.id, "承認者").ok, false);
});

test("6C-4. PDF化は既定OFF（承認済みでもフラグOFFならブロック）、ONで解禁", async () => {
  const id = await seedTask("見積書お願いします 宛名T商事 品目A 数量1");
  const doc = generateDocument(id, "quotation", "M");
  approveDocument(doc.id, "承認者");
  // 既定OFF
  const off = renderDocumentPdf(doc.id);
  assert.equal(off.ok, false);
  assert.match(off.error!, /DOCUMENT_PDF_ENABLED|無効/);
  // 明示ONで解禁
  config.documents.pdfEnabled = true;
  const on = renderDocumentPdf(doc.id);
  assert.equal(on.ok, true);
  assert.ok(on.html!.includes("御見積書"));
  config.documents.pdfEnabled = false;
});

test("6D-1. 想定対実績差（タスク単位）", async () => {
  const id = await seedTask("見積書お願いします 宛名T商事"); // estimate 90（見積テンプレ）
  addTimeEntry(id, "stf_a", 120, "作業", "A");
  const ea = estimateVsActual();
  const row = ea.rows.find((r) => r.task_id === id)!;
  assert.equal(row.estimate_min, 90);
  assert.equal(row.actual_min, 120);
  assert.equal(row.diff_min, 30); // 実績-想定
});

test("6D-2. スタッフ別工数", () => {
  const w = workloadByStaff();
  const a = w.find((r) => r.staff_id === "stf_a")!;
  assert.ok(a.actual_min >= 120);
});

test("6D-3. クライアント別収益（time×単価）／未設定・固定は要確認扱い", () => {
  const rev = revenueByClient();
  const t = rev.rows.find((r) => r.client_id === "cli_t")!;
  assert.ok(t.revenue !== null && t.revenue > 0); // 実績分 × 3000円/時
  const x = rev.rows.find((r) => r.client_id === "cli_x")!;
  assert.equal(x.revenue, null);
  assert.match(x.note, /要単価設定/);
  const f = rev.rows.find((r) => r.client_id === "cli_f")!;
  assert.equal(f.revenue, null);
  assert.match(f.note, /固定課金/);
});

test("cleanup", () => {
  db.close();
  for (const s of ["", "-wal", "-shm"]) { try { rmSync(DBP + s); } catch {} }
});
