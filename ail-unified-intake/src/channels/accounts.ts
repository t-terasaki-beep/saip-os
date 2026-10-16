// チャネル口座ごとの受信/送信可否と、クライアント固有の注意事項。
//   受信: inbound_enabled=0 の口座は受信しない（保存もしない）。
//   送信: outbound_enabled=1 の口座が無ければ送らない（全体OFF・未承認と合わせて3ゲート）。
import { db } from "../db.js";

export interface MatchedIdentifier { channel: string; identifier: string; }

// 受信ブロック判定：一致した口座のいずれかが inbound_enabled=0 ならブロック。
export function inboundBlocked(channel: string, identifiers: MatchedIdentifier[]): boolean {
  for (const m of identifiers) {
    if (m.channel !== channel) continue;
    const row = db
      .prepare("SELECT inbound_enabled FROM client_identifiers WHERE channel=? AND identifier=?")
      .get(m.channel, m.identifier) as { inbound_enabled: number } | undefined;
    if (row && row.inbound_enabled === 0) return true;
  }
  return false;
}

// 送信ブロック理由（null=許可）。クライアント未特定・口座行なし・送信ON口座なし でブロック。
export function outboundBlockedReason(clientId: string | null, channel: string): string | null {
  if (!clientId) return "送信先クライアントが未特定（口座照合なし）";
  const rows = db
    .prepare("SELECT outbound_enabled FROM client_identifiers WHERE client_id=? AND channel=?")
    .all(clientId, channel) as { outbound_enabled: number }[];
  if (rows.length === 0) return "この口座は未登録（送信先なし）";
  if (!rows.some((r) => r.outbound_enabled === 1)) return "この口座は送信OFF（outbound_enabled=0）";
  return null;
}

export function clientNotes(clientId: string | null): string | null {
  if (!clientId) return null;
  const row = db.prepare("SELECT operational_notes FROM clients WHERE id=?").get(clientId) as
    | { operational_notes: string | null }
    | undefined;
  return row?.operational_notes ?? null;
}

export function setClientNotes(clientId: string, notes: string | null): { ok: boolean } {
  const r = db.prepare("UPDATE clients SET operational_notes=? WHERE id=?").run(notes, clientId);
  return { ok: r.changes > 0 };
}

// 口座フラグ更新（manager/admin 用）。inbound/outbound を部分更新。
export function setAccountFlags(
  channel: string,
  identifier: string,
  flags: { inbound?: boolean; outbound?: boolean }
): { ok: boolean } {
  const sets: string[] = [];
  const vals: (number | string)[] = [];
  if (flags.inbound !== undefined) { sets.push("inbound_enabled=?"); vals.push(flags.inbound ? 1 : 0); }
  if (flags.outbound !== undefined) { sets.push("outbound_enabled=?"); vals.push(flags.outbound ? 1 : 0); }
  if (sets.length === 0) return { ok: false };
  vals.push(channel, identifier);
  const r = db
    .prepare(`UPDATE client_identifiers SET ${sets.join(", ")} WHERE channel=? AND identifier=?`)
    .run(...vals);
  return { ok: r.changes > 0 };
}
