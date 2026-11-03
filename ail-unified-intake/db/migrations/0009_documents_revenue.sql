-- Phase 6C: 見積・請求 書類の半自動化（金額はAIが確定しない＝TEXTで依頼のまま保持）。
-- Phase 6D: 工数・収益の可視化（time課金の時間単価をクライアントに持たせる）。

-- 生成書類（見積書/請求書）。金額系は確定しないため TEXT（「依頼記載のまま」「要確認」を保持）。
CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  task_id      TEXT,
  client_id    TEXT,
  type         TEXT NOT NULL,            -- quotation / invoice
  title        TEXT,
  line_items   TEXT NOT NULL DEFAULT '[]', -- JSON: [{name, qty, unit_price_text, amount_text}]
  subtotal_text TEXT,
  tax_text      TEXT,
  total_text    TEXT,
  note          TEXT,
  status       TEXT NOT NULL DEFAULT 'draft', -- draft / approved / issued
  created_by   TEXT,
  approved_by  TEXT,
  approved_at  INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_task   ON documents(task_id);
CREATE INDEX IF NOT EXISTS idx_documents_client ON documents(client_id);

-- time課金の時間単価（円/時）。未設定(null)なら収益は算出せず「要単価設定」と表示。
ALTER TABLE clients ADD COLUMN hourly_rate INTEGER;
