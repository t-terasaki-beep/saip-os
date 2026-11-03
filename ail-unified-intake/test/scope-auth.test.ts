import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DBP = `./data/test-scope-${Date.now()}.db`;
process.env.DATABASE_PATH = DBP;
process.env.AI_PROVIDER = "mock";
process.env.NODE_ENV = "test";

const { db, migrate } = await import("../src/db.js");
migrate();

db.exec(`
  INSERT INTO clients (id, company, name, manager_id, created_at) VALUES
    ('cli_a','A','A商事','stf_mgr_a',0),
    ('cli_b','B','B工業','stf_mgr_b',0);
  INSERT INTO client_identifiers (id, client_id, channel, identifier) VALUES
    ('idf_a','cli_a','chatwork','cw-a'),
    ('idf_b','cli_b','chatwork','cw-b');
  INSERT INTO staff (id,name,role,skills,weekly_capacity_min,notify_channel,active,created_at) VALUES
    ('stf_mgr_a','高市','manager','["見積"]',2400,'log:a',1,0),
    ('stf_mgr_b','佐藤','manager','["請求書"]',2400,'log:b',1,0),
    ('stf_worker','田中','staff','["請求書"]',1800,'log:w',1,0);
  INSERT INTO users (id,name,role,staff_id,token,active,created_at) VALUES
    ('u_adm','管理者','admin',NULL,'tok-admin',1,0),
    ('u_mgr_a','高市','manager','stf_mgr_a','tok-mgr-a',1,0),
    ('u_mgr_b','佐藤','manager','stf_mgr_b','tok-mgr-b',1,0),
    ('u_worker','田中','staff','stf_worker','tok-worker',1,0);
  INSERT INTO task_templates (id,task_type,default_minutes) VALUES ('t1','見積',90);
`);

const { ingest } = await import("../src/ingest/pipeline.js");
const { processAll } = await import("../src/jobs/worker.js");
const { taskInScope, documentInScope, userByToken } = await import("../src/auth/rbac.js");
const { assignTask } = await import("../src/assign/assign.js");
const { generateDocument } = await import("../src/documents/documents.js");

async function seedTask(sender: string) {
  const o = ingest({ channel: "chatwork", externalId: `sc-${Math.random()}`, senderRaw: sender, bodyRaw: "見積お願いします", receivedAt: 0 });
  await processAll();
  return o.taskId!;
}

const vAdmin = userByToken("tok-admin")!;
const vMgrA = userByToken("tok-mgr-a")!;
const vMgrB = userByToken("tok-mgr-b")!;
const vWorker = userByToken("tok-worker")!;

test("taskInScope: admin sees all tasks", async () => {
  const idA = await seedTask("cw-a");
  const idB = await seedTask("cw-b");
  assert.equal(taskInScope(vAdmin, idA), true);
  assert.equal(taskInScope(vAdmin, idB), true);
});

test("taskInScope: manager sees only their managed tasks", async () => {
  const idA = await seedTask("cw-a"); // manager_id = stf_mgr_a
  const idB = await seedTask("cw-b"); // manager_id = stf_mgr_b
  assert.equal(taskInScope(vMgrA, idA), true);
  assert.equal(taskInScope(vMgrA, idB), false);
  assert.equal(taskInScope(vMgrB, idB), true);
  assert.equal(taskInScope(vMgrB, idA), false);
});

test("taskInScope: staff sees only their assigned tasks", async () => {
  const id = await seedTask("cw-a");
  assert.equal(taskInScope(vWorker, id), false); // not assigned
  assignTask(id, "stf_worker", "高市");
  assert.equal(taskInScope(vWorker, id), true);  // now assigned
});

test("taskInScope: nonexistent task returns null", () => {
  assert.equal(taskInScope(vAdmin, "task_nonexistent"), null);
  assert.equal(taskInScope(vWorker, "task_nonexistent"), null);
});

test("documentInScope: follows task scope", async () => {
  const idA = await seedTask("cw-a");
  const doc = generateDocument(idA, "quotation", "高市");
  assert.equal(documentInScope(vMgrA, doc.id), true);
  assert.equal(documentInScope(vMgrB, doc.id), false);
  assert.equal(documentInScope(vAdmin, doc.id), true);
});

test("documentInScope: nonexistent document returns null", () => {
  assert.equal(documentInScope(vAdmin, "doc_nonexistent"), null);
});

test("cleanup", () => {
  db.close();
  for (const s of ["", "-wal", "-shm"]) { try { rmSync(DBP + s); } catch {} }
});
