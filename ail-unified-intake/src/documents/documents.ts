// Phase 6C: 見積・請求 書類の半自動化。
//   依頼本文から 品目・数量 を拾って明細の下書きを作る。金額はAIが確定しない（TEXTで「依頼のまま/要確認」を保持）。
//   生成→承認（PDF化承認者）→（PDF化は既定OFF）の順。送付は別途・承認後。
import { db, now } from "../db.js";
import { id } from "../util/id.js";
import { config } from "../config.js";

export interface LineItem { name: string; qty: string; unit_price_text: string; amount_text: string; }

// 本文から明細をゆるく抽出。無理に数値化しない（金額は要確認のまま）。
export function parseLineItems(body: string): LineItem[] {
  const text = (body || "").replace(/\s+/g, " ");
  const name = text.match(/品目[:：]\s*([^、。\s]+)/)?.[1]
    ?? text.match(/内容[:：]\s*([^、。\s]+)/)?.[1]
    ?? "(要確認)";
  const qty = text.match(/数量[:：]\s*([0-9０-９]+[^、。\s]*)/)?.[1] ?? "(要確認)";
  // 金額はAIが確定しない：本文に明記があればその表記のまま、無ければ要確認
  const amount = text.match(/(?:金額|単価|価格)[:：]\s*([^、。\s]+)/)?.[1]
    ?? text.match(/([¥￥]?\s?[0-9０-９,，]+\s?円)/)?.[1]
    ?? "(要確認・当方で確定しない)";
  return [{ name, qty, unit_price_text: amount, amount_text: amount }];
}

export function generateDocument(
  taskId: string,
  type: "quotation" | "invoice",
  actor: string
): { id: string } {
  const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(taskId) as any;
  const client = task?.client_id ? (db.prepare("SELECT name FROM clients WHERE id=?").get(task.client_id) as any) : null;
  const items = parseLineItems(task?.body ?? "");
  const t = now();
  const did = id("doc");
  const title = `${type === "quotation" ? "見積書" : "請求書"}（${client?.name ?? "宛名要確認"}）`;
  db.prepare(
    `INSERT INTO documents (id, task_id, client_id, type, title, line_items, subtotal_text, tax_text, total_text, note, status, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'draft', ?, ?, ?)`
  ).run(
    did, taskId, task?.client_id ?? null, type, title, JSON.stringify(items),
    "(要確認)", "(要確認)", "(要確認・金額は依頼記載のまま／当方で確定しない)",
    "金額はAIが確定しません。担当が確定してください。", actor, t, t
  );
  db.prepare("INSERT INTO audit_log (id, task_id, actor, action, detail, created_at) VALUES (?,?,?,?,?,?)")
    .run(id("aud"), taskId, actor, "doc_generate", `${type} ${did}`, t);
  return { id: did };
}

export function getDocument(docId: string): any | null {
  const d = db.prepare("SELECT * FROM documents WHERE id=?").get(docId) as any;
  if (!d) return null;
  try { d.line_items = JSON.parse(d.line_items || "[]"); } catch { d.line_items = []; }
  return d;
}

export function approveDocument(docId: string, actor: string): { ok: boolean; error?: string } {
  const d = db.prepare("SELECT status FROM documents WHERE id=?").get(docId) as any;
  if (!d) return { ok: false, error: "書類なし" };
  if (d.status !== "draft") return { ok: false, error: "draft以外は承認できません" };
  db.prepare("UPDATE documents SET status='approved', approved_by=?, approved_at=?, updated_at=? WHERE id=?")
    .run(actor, now(), now(), docId);
  return { ok: true };
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

// HTMLは常に生成可能（画面プレビュー用）。
export function renderDocumentHtml(docId: string): string | null {
  const d = getDocument(docId);
  if (!d) return null;
  const rows = (d.line_items as LineItem[])
    .map((it) => `<tr><td>${esc(it.name)}</td><td>${esc(it.qty)}</td><td>${esc(it.unit_price_text)}</td><td>${esc(it.amount_text)}</td></tr>`)
    .join("");
  return `<!doctype html><meta charset="utf-8"><title>${esc(d.title)}</title>
  <body style="font-family:sans-serif;max-width:720px;margin:24px auto">
  <h1>${esc(d.type === "quotation" ? "御見積書" : "御請求書")}</h1>
  <p>${esc(d.title)}　<span style="color:#b26a00">[${esc(d.status)}]</span></p>
  <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
    <thead><tr><th>品目</th><th>数量</th><th>単価</th><th>金額</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><td colspan="3" align="right">小計</td><td>${esc(d.subtotal_text)}</td></tr>
      <tr><td colspan="3" align="right">消費税</td><td>${esc(d.tax_text)}</td></tr>
      <tr><td colspan="3" align="right"><b>合計</b></td><td><b>${esc(d.total_text)}</b></td></tr>
    </tfoot>
  </table>
  <p style="color:#b00">※ ${esc(d.note)}</p></body>`;
}

// PDF化は既定OFF（承認・PDF化承認者の運用に合わせ、フラグONで解禁）。実PDF生成器は本番で差し替え。
export function renderDocumentPdf(docId: string): { ok: boolean; html?: string; error?: string } {
  if (!config.documents.pdfEnabled) {
    return { ok: false, error: "PDF化は無効（DOCUMENT_PDF_ENABLED=false）。承認後にPDF化承認者の運用で有効化してください。" };
  }
  const d = getDocument(docId);
  if (!d) return { ok: false, error: "書類なし" };
  if (d.status !== "approved") return { ok: false, error: "承認済みのみPDF化できます" };
  // 本番では HTML→PDF 変換器に接続。ここではHTMLを返す（配線先の差し替えポイント）。
  return { ok: true, html: renderDocumentHtml(docId)! };
}
