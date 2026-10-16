// 受付パイプライン：原文保存 → クライアント照合 → タスク生成 → 解析ジョブ投入。
//   受信は口座単位でOFFにでき、OFF口座は保存もしない。重複（channel+external_id）は捨てる。
import { db, now } from "../db.js";
import { id } from "../util/id.js";
import { inboundBlocked, type MatchedIdentifier } from "../channels/accounts.js";
import { enqueue } from "../jobs/queue.js";

export interface IngestInput {
  channel: string;
  externalId: string;
  threadKey?: string;
  sourceUrl?: string;
  senderRaw?: string;
  bodyRaw: string;
  receivedAt: number;
}

export interface IngestResult {
  status: "created" | "duplicate" | "disabled";
  taskId?: string;
  rawId?: string;
  detail?: string;
}

// 送信元の生識別子から、一致しうる口座候補を作る（Chatworkのaccount_id等）。
function matchedIdentifiers(m: IngestInput): MatchedIdentifier[] {
  const out: MatchedIdentifier[] = [];
  if (m.senderRaw) out.push({ channel: m.channel, identifier: m.senderRaw });
  return out;
}

function findClientId(ids: MatchedIdentifier[]): string | null {
  for (const i of ids) {
    const row = db
      .prepare("SELECT client_id FROM client_identifiers WHERE channel=? AND identifier=?")
      .get(i.channel, i.identifier) as { client_id: string } | undefined;
    if (row) return row.client_id;
  }
  return null;
}

export function ingest(m: IngestInput): IngestResult {
  const identifiers = matchedIdentifiers(m);

  // 受信ゲート（口座OFF）：保存もしない
  if (inboundBlocked(m.channel, identifiers)) {
    return { status: "disabled", detail: "この口座は受信OFF（inbound_enabled=0）" };
  }

  // 重複排除
  const dup = db
    .prepare("SELECT id FROM raw_messages WHERE channel=? AND external_id=?")
    .get(m.channel, m.externalId) as { id: string } | undefined;
  if (dup) return { status: "duplicate", rawId: dup.id };

  const t = now();
  const rawId = id("raw");
  db.prepare(
    `INSERT INTO raw_messages (id, channel, external_id, thread_key, source_url, sender_raw, body_raw, received_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(rawId, m.channel, m.externalId, m.threadKey ?? null, m.sourceUrl ?? null, m.senderRaw ?? null, m.bodyRaw, m.receivedAt, t);

  const clientId = findClientId(identifiers);
  const managerId = clientId
    ? ((db.prepare("SELECT manager_id FROM clients WHERE id=?").get(clientId) as { manager_id: string } | undefined)?.manager_id ?? null)
    : null;

  const taskId = id("task");
  db.prepare(
    `INSERT INTO tasks (id, raw_id, channel, client_id, manager_id, title, body, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?, 'inbox', ?, ?)`
  ).run(taskId, rawId, m.channel, clientId, managerId, m.bodyRaw.slice(0, 60), m.bodyRaw, t, t);

  db.prepare("INSERT INTO audit_log (id, task_id, actor, action, detail, created_at) VALUES (?,?,?,?,?,?)")
    .run(id("aud"), taskId, "system", "ingest", `channel=${m.channel}`, t);

  enqueue("analyze", { taskId });
  return { status: "created", taskId, rawId };
}
