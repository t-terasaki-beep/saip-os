# 高市さん向けデモ公開ゲート（2026-11-03）

## 判定
**案件スコープ認可を実装済み。** 外部公開にはホスティング・認証基盤・HTTPS環境の整備が残る。localhost は外部共有不可。

## コード監査で確認した公開前のブロッカーと対応状況
1. ~~`src/server.ts` の `GET /api/tasks/:id` は認証済みかのみを確認し、管理対象タスクかを確認していない。~~
   **→ 修正済み。** `taskInScope()` ヘルパーを `rbac.ts` に追加し、全タスクAPI（tasks/:id, candidates, time, complete, assign, draft, quote, invoice）に適用。スコープ外は403、存在しないタスクは404を返す。
2. ~~`GET /api/candidates/:taskId`、`GET /api/documents/:id`、`POST /api/tasks/:id/time`、`POST /api/tasks/:id/complete` も対象案件の閲覧・更新権限の確認が不足。~~
   **→ 修正済み。** `documentInScope()` ヘルパーも追加し、書類APIにも適用。テスト7件追加（test/scope-auth.test.ts）。
3. `POST /webhooks/chatwork` は機能フラグとペイロード検査のみ。Webhook署名の検証が見当たらない。**→ 未修正（デモでは CHATWORK_INGEST_ENABLED=false で無効化）。** 実運用時に署名検証・リプレイ防止を追加する。
4. 管理画面は `GET /` で未認証でも配信される。実データはAPIで保護する設計だが、公開デモでは認証付きゲートを推奨。**→ 未修正（デモではAPIレベルの認可で保護。HTMLはデータを含まない）。**
5. `x-token` ヘッダーを許容している。外部公開前に安全なセッション認証・トークン保管・ログ秘匿・HTTPSを設計する。**→ 未修正（デモスコープ外。外部公開時に対応）。**

## 最初の公開可能なデモの仕様
- 匿名の架空企業・架空担当者だけを投入。実顧客データ、実連絡先、実APIキーなし。
- `AI_PROVIDER=mock`, `CHATWORK_INGEST_ENABLED=false`, `GMAIL_INGEST_ENABLED=false`, `ALLOW_OUTBOUND_SEND=false`, `DOCUMENT_PDF_ENABLED=false` を固定。
- 管理画面は認証付きHTTPS環境に配置。テスト用DBは本番から完全分離。外部送信機能を無効化。
- タスク・文書・候補者・更新APIのテナント/担当スコープを強制し、他担当IDを指定した403/404テストを追加。 **→ 実装済み。**
- Webhookは公開デモで無効化。実運用時のみ署名検証後に有効化。
- CI成功、権限境界テスト、外部送信禁止テスト、匿名UIスモークテストをすべて確認してから公開。
- 公開先URLは安全なホスティング・認証・費用を確定してから決定。公開や課金は未実施。

## 次の実装順
1. ~~案件スコープ認可ヘルパーを導入し、全タスク/文書APIに適用。~~ **完了。**
2. ~~別ユーザーの案件IDを使う権限逸脱テストを追加。~~ **完了（test/scope-auth.test.ts: 7テスト）。**
3. 匿名デモ専用の起動構成とアクセス制限を整備。
4. CIと手動スモークテストに合格後、デモURLを発行。

## 現在の検証証跡
- GitHub Actions run 41474894791: success（typecheck、unit/safety tests、anonymous rehearsal）。
- ローカル検証: typecheck clean, 31/31 tests pass, 10/10 rehearsal pass（スコープ認可テスト7件を含む）。
- 本ファイルは公開承認ではなく、安全なデモ実装に向けた検収条件。
