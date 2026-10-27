-- パイロット制御：クライアント固有の注意事項＋口座別の受信/送信可否。
-- 送信は「全体OFF・口座OFF・未承認」のいずれかで必ずブロック（口座OFFが安全既定）。

ALTER TABLE clients ADD COLUMN operational_notes TEXT;

ALTER TABLE client_identifiers ADD COLUMN inbound_enabled  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE client_identifiers ADD COLUMN outbound_enabled INTEGER NOT NULL DEFAULT 0;
