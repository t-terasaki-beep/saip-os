-- パイロット リハーサル用の匿名フィクスチャ（実データ・実PIIなし）。トークンはダミー。
-- 受信ON/送信OFFの口座設定・クライアント注意事項を含む。

-- クライアント（ダミー）。operational_notes に取り扱い注意点。
INSERT INTO clients (id, company, name, manager_id, billing_type, operational_notes, created_at) VALUES
  ('cli_pilot1', 'A', 'パイロット商事（ダミー）', 'stf_mgr', 'time',
   '電話NG・連絡はチャットのみ。請求書は必ず担当部長をCC。金額は依頼記載のまま（当方で確定しない）。', 1720000000000);

-- チャネル口座：受信ON・送信OFF（顧客送信は口座単位で明示ONするまでブロック）
INSERT INTO client_identifiers (id, client_id, channel, identifier, inbound_enabled, outbound_enabled) VALUES
  ('idf_p1', 'cli_pilot1', 'chatwork', 'cw-pilot', 1, 0);

-- スタッフ（ダミー・匿名）
INSERT INTO staff (id, name, role, skills, weekly_capacity_min, notify_channel, active, created_at) VALUES
  ('stf_mgr', 'マネージャーM（ダミー）', 'manager', '["請求書","見積","資料作成"]', 2400, 'log:mgr', 1, 1720000000000),
  ('stf_a',   'スタッフA（ダミー）',     'staff',   '["請求書","入金確認"]',         1800, 'log:a',   1, 1720000000000),
  ('stf_b',   'スタッフB（ダミー）',     'staff',   '["経費入力","勤怠"]',           1200, 'log:b',   1, 1720000000000);

-- 業務テンプレ（標準想定工数・分）
INSERT INTO task_templates (id, task_type, default_minutes) VALUES
  ('tpl_inv','請求書',120),('tpl_quo','見積',90),('tpl_pay','入金確認',60),
  ('tpl_exp','経費入力',100),('tpl_att','勤怠',90),('tpl_doc','資料作成',150),('tpl_arr','手配',45);

-- ユーザー（RBAC・ダミートークン。実運用は差し替え、seed.your.sql はコミットしない）
INSERT INTO users (id, email, name, role, staff_id, token, active, created_at) VALUES
  ('usr_admin', 'admin@example.test', '管理者（ダミー）',       'admin',   NULL,      'REHEARSAL_ADMIN', 1, 1720000000000),
  ('usr_mgr',   'mgr@example.test',   'マネージャー（ダミー）', 'manager', 'stf_mgr', 'REHEARSAL_MGR',   1, 1720000000000),
  ('usr_a',     'a@example.test',     'スタッフA（ダミー）',   'staff',   'stf_a',   'REHEARSAL_STAFF', 1, 1720000000000);
