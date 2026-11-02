-- 統合受付エンジン 初期スキーマ。
-- 外部送信/返信は初期状態で必ずOFF（承認なしで送らない）。機微情報はseedに保存しない。

-- 原文（受信した依頼メッセージの原本保存）
CREATE TABLE IF NOT EXISTS raw_messages (
  id          TEXT PRIMARY KEY,
  channel     TEXT NOT NULL,              -- chatwork / gmail / lineworks ...
  external_id TEXT NOT NULL,              -- チャネル側のメッセージID（重複排除キー）
  thread_key  TEXT,
  source_url  TEXT,
  sender_raw  TEXT,                       -- 送信元の生識別子（account_id / from アドレス等）
  body_raw    TEXT NOT NULL,
  received_at INTEGER NOT NULL,           -- epoch ms
  created_at  INTEGER NOT NULL,
  UNIQUE (channel, external_id)
);

-- クライアント（依頼元企業）
CREATE TABLE IF NOT EXISTS clients (
  id           TEXT PRIMARY KEY,
  company      TEXT,
  name         TEXT NOT NULL,
  manager_id   TEXT,                      -- 担当マネージャー（staff.id）
  billing_type TEXT DEFAULT 'time',       -- time / fixed
  created_at   INTEGER NOT NULL
);

-- クライアントのチャネル口座（どの窓口から来たらどのクライアントか）
CREATE TABLE IF NOT EXISTS client_identifiers (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL,
  channel    TEXT NOT NULL,
  identifier TEXT NOT NULL,               -- account_id / メールアドレス / room 等
  UNIQUE (channel, identifier)
);

-- スタッフ（作業者）
CREATE TABLE IF NOT EXISTS staff (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'staff',  -- manager / staff
  skills              TEXT NOT NULL DEFAULT '[]',     -- JSON配列（得意業務）
  weekly_capacity_min INTEGER NOT NULL DEFAULT 2400,  -- 週あたり対応可能分
  notify_channel      TEXT,                           -- 通知先（log:... で記録のみ）
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          INTEGER NOT NULL
);

-- 業務テンプレ（標準想定工数）
CREATE TABLE IF NOT EXISTS task_templates (
  id              TEXT PRIMARY KEY,
  task_type       TEXT NOT NULL UNIQUE,
  default_minutes INTEGER NOT NULL
);

-- タスク（受付→解析の結果、1依頼＝1タスク）
CREATE TABLE IF NOT EXISTS tasks (
  id                     TEXT PRIMARY KEY,
  raw_id                 TEXT,
  channel                TEXT NOT NULL,
  client_id              TEXT,
  title                  TEXT,
  body                   TEXT,
  category               TEXT,            -- OnlineSecretaryTaskCategory
  task_type              TEXT,            -- テンプレ照合用（請求書 等）
  status                 TEXT NOT NULL DEFAULT 'inbox',  -- inbox/analyzed/assigned/in_progress/done
  priority               TEXT DEFAULT 'normal',          -- low/normal/high/urgent
  assignee_id            TEXT,
  manager_id             TEXT,
  deadline_at            INTEGER,
  estimate_min           INTEGER,
  confidence             REAL,
  missing_info           TEXT,            -- JSON配列（不足情報）
  attachment_ai_consent  INTEGER NOT NULL DEFAULT 0,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL
);

-- 通知（割当・依頼連絡。外部送信OFF時は status=recorded で記録のみ）
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  to_staff_id TEXT,
  channel     TEXT,
  body        TEXT,
  status      TEXT NOT NULL DEFAULT 'recorded',  -- recorded / sent
  created_at  INTEGER NOT NULL
);

-- 確認文案（顧客への確認メッセージ。承認制・既定は未送信）
CREATE TABLE IF NOT EXISTS confirmation_drafts (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending / approved / sent
  created_by  TEXT,
  approved_by TEXT,
  approved_at INTEGER,
  sent_at     INTEGER,
  created_at  INTEGER NOT NULL
);

-- 実績時間（15分単位）
CREATE TABLE IF NOT EXISTS time_entries (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL,
  staff_id   TEXT NOT NULL,
  minutes    INTEGER NOT NULL,
  note       TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);

-- 監査ログ
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  task_id    TEXT,
  actor      TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at INTEGER NOT NULL
);

-- 非同期ジョブキュー（解析などを順次処理）
CREATE TABLE IF NOT EXISTS jobs (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  payload    TEXT,
  status     TEXT NOT NULL DEFAULT 'queued',  -- queued/running/done/failed
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- RBAC ユーザー（Bearerトークン＋ロール）
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT,
  name       TEXT,
  role       TEXT NOT NULL,              -- admin / manager / staff
  staff_id   TEXT,
  token      TEXT NOT NULL UNIQUE,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_client   ON tasks(client_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_notif_task     ON notifications(task_id);
CREATE INDEX IF NOT EXISTS idx_time_task      ON time_entries(task_id);
