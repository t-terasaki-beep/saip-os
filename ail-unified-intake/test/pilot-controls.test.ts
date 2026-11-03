import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DBP = `./data/testpc-${Date.now()}.db`;
process.env.DATABASE_PATH = DBP;
process.env.AI_PROVIDER = "mock";
process.env.NODE_ENV = "test";

const { db, migrate } = await import("../src/db.js");
migrate();

db.exec(`
  INSERT INTO clients (id, company, name, manager_id, operational_notes, created_at) VALUES
    ('cli_p','P','P商事','stf_mgr','電話NG・請求書は部長CC・金額は依頼のまま',0);
  INSERT INTO client_identifiers (id, client_id, channel, identifier, inbound_enabled, outbound_enabled) VALUES
    ('idf_p','cli_p','chatwork','cw-p',1,0),
    ('idf_off','cli_p','chatwork','cw-off',0,0);
  INSERT INTO staff (id,name,role,skills,weekly_capacity_min,notify_channel,active,created_at) VALUES
    ('stf_mgr','M','manager','["請求書","見積"]',2400,'log:m',1,0);
  INSERT INTO users (id,name,role,staff_id,token,active,created_at) VALUES
    ('u_mgr','M','manager','stf_mgr','tok-m',1,0);
  INSERT INTO task_templates (id,task_type,default_minutes) VALUES ('t','見積',90);
`);

const { ingest } = await import("../src/ingest/pipeline.js");
const { processAll } = await import("../src/jobs/worker.js");
const { generateDraft, approveDraft, sendDraft } = await import("../src/drafts/drafts.js");
const { config } = await import("../src/config.js");
const { clientNotes, inboundBlocked, outboundBlockedReason, setAccountFlags } = await import("../src/channels/accounts.js");

test("1. クライアント注意事項の保持・取得", () => {
  assert.match(clientNotes("cli_p")!, /部長CC/);
  assert.equal(clientNotes(null), null);
});

test("2. 受信ブロック: inbound_enabled=0 の口座は受信しない（保存もしない）", () => {
  const out = ingest({ channel: "chatwork", externalId: "x1", senderRaw: "cw-off", bodyRaw: "見積お願いします", receivedAt: 0 });
  assert.equal(out.status, "disabled");
  const raw = db.prepare("SELECT COUNT(*) n FROM raw_messages WHERE external_id='x1'").get() as any;
  assert.equal(raw.n, 0); // 保存されていない
});

test("3. 送信は 全体OFF・口座OFF・未承認 のいずれかで必ずブロック、全て満たすと送信", async () => {
  const o = ingest({ channel: "chatwork", externalId: "x2", senderRaw: "cw-p", bodyRaw: "見積書お願いします 宛名P商事", receivedAt: 0 });
  await processAll();
  const d = generateDraft(o.taskId!, "M");

  // (a) 未承認 → ブロック
  assert.equal(sendDraft(d.id, "M").ok, false);
  approveDraft(d.id, "M");

  // (b) 承認済みでも 全体OFF → ブロック
  config.allowOutboundSend = false;
  let r = sendDraft(d.id, "M");
  assert.equal(r.ok, false);
  assert.match(r.error!, /ALLOW_OUTBOUND_SEND/);

  // (c) 全体ONでも 口座OFF → ブロック
  config.allowOutboundSend = true;
  r = sendDraft(d.id, "M");
  assert.equal(r.ok, false);
  assert.match(r.error!, /口座/);

  // (d) 全体ON＋口座ON＋承認済み → 送信成功
  setAccountFlags("chatwork", "cw-p", { outbound: true });
  r = sendDraft(d.id, "M");
  assert.equal(r.ok, true);

  config.allowOutboundSend = false;
  setAccountFlags("chatwork", "cw-p", { outbound: false });
});

test("4. outboundBlockedReason: クライアント未特定は送信不可（送信先口座が無い）", () => {
  assert.ok(outboundBlockedReason(null, "chatwork"));          // 未特定
  assert.ok(outboundBlockedReason("cli_p", "chatwork"));       // 口座OFF
  assert.equal(inboundBlocked("chatwork", [{ channel: "chatwork", identifier: "cw-p" }]), false); // 受信ONは通る
});

test("cleanup", () => {
  db.close();
  for (const s of ["", "-wal", "-shm"]) { try { rmSync(DBP + s); } catch {} }
});
