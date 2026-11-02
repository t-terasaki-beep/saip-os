# 高市さん向けデモ公開ゲート（2026-11-03）

## 判定
**現状は公開不可。** PR #1 の CI は型検査・既存テスト・匿名リハーサルに成功したが、外部公開の安全性は未検証。localhost は外部共有不可。

## コード監査で確認した公開前のブロッカー
1. `src/server.ts` の `GET /api/tasks/:id` は認証済みかのみを確認し、管理対象タスクかを確認していない。IDを知る別のスタッフが閲覧できる可能性。
2. `GET /api/candidates/:taskId`、`GET /api/documents/:id`、`POST /api/tasks/:id/time`、`POST /api/tasks/:id/complete` も対象案件の閲覧・更新権限の確認が不足。ロールだけでなく案件スコープの強制が必要。
3. `POST /webhooks/chatwork` は機能フラグとペイロード検査のみ。Webhook署名の検証が見当たらない。公開時は署名検証・リプレイ防止を追加する。
4. 管理画面は `GET /` で未認証でも配信される。実データはAPIで保護する設計だが、公開デモでは認証付きゲートを推奨。
5. `x-token` ヘッダーを許容している。外部公開前に安全なセッション認証・トークン保管・ログ秘匿・HTTPSを設計する。

## 最初の公開可能なデモの仕様
- 匿名の架空企業・架空担当者だけを投入。実顧客データ、実連絡先、実APIキーなし。
- `AI_PROVIDER=mock`, `CHATWORK_INGEST_ENABLED=false`, `GMAIL_INGEST_ENABLED=false`, `ALLOW_OUTBOUND_SEND=false`, `DOCUMENT_PDF_ENABLED=false` を固定。
- 管理画面は認証付きHTTPS環境に配置。テスト用DBは本番から完全分離。外部送信機能を無効化。
- タスク・文書・候補者・更新APIのテナント/担当スコープを強制し、他担当IDを指定した403/404テストを追加。
- Webhookは公開デモで無効化。実運用時のみ署名検証後に有効化。
- CI成功、権限境界テスト、外部送信禁止テスト、匿名UIスモークテストをすべて確認してから公開。
- 公開先URLは安全なホスティング・認証・費用を確定してから決定。公開や課金は未実施。

## 次の実装順
1. 案件スコープ認可ヘルパーを導入し、全タスク/文書APIに適用。
2. 別ユーザーの案件IDを使う権限逸脱テストを追加。
3. 匿名デモ専用の起動構成とアクセス制限を整備。
4. CIと手動スモークテストに合格後、デモURLを発行。

## 現在の検証証跡
- GitHub Actions run 41474894791: success（typecheck、unit/safety tests、anonymous rehearsal）。
- 本ファイルは公開承認ではなく、安全なデモ実装に向けた検収条件。
