# パイロット リハーサル手順（匿名データ・実接続なし）

実クライアント1社を入れる前に、**受付→分類→クライアント照合→注意事項確認→候補提示→手動割当→実績時間→承認待ち**を通しで検証する。
実データ・実PII・実送信は使わない（`AI_PROVIDER=mock`、外部送信・実受信OFF）。

## いちばん簡単：ワンコマンド
```bash
cd ail-unified-intake
npm install
npm run rehearsal
```
専用の使い捨てDBに匿名フィクスチャ（`db/seed.pilot-rehearsal.sql`）を入れ、全工程を自動実行。**10 PASS で合格**：
```
✅ 受付：依頼を統合インボックスへ
✅ 分類：業務カテゴリ付与（quotation_invoice）
✅ 照合：クライアント特定（パイロット商事・ダミー）
✅ 注意事項：クライアント固有ルール表示（電話NG／部長CC 等）
✅ 候補提示：実作業者候補（根拠つき）
✅ 手動割当：担当確定＋通知記録（外部送信なし）
✅ 実績：15分単位で記録／非15分は拒否
✅ 承認待ち：確認文案を作成（未送信）
✅ 送信ブロック：承認/全体/口座のいずれかで送らない
```

## 画面（コンソール）で手動リハーサル
```bash
cp .env.example .env
# .env: CHATWORK_INGEST_ENABLED=true（受信ON）、ALLOW_OUTBOUND_SEND=false（送信OFF）、AI_PROVIDER=mock
DATABASE_PATH=./data/intake.db npx tsx scripts/load-seed.ts db/seed.pilot-rehearsal.sql
npm run dev
```
- コンソール `http://localhost:8787/` にトークン `REHEARSAL_MGR`（マネージャー）でログイン。
- Webhookを模して受付を投入：
  ```bash
  curl -s -X POST localhost:8787/webhooks/chatwork -H 'Content-Type: application/json' \
    -d '{"webhook_event":{"room_id":1,"message_id":"rh-1","account_id":"cw-pilot","body":"見積書お願いします 品目コンサル 数量1 宛名パイロット商事","send_time":1720900000}}'
  ```
- 確認項目（＝各工程）：受付→分類「請求・見積」→照合「パイロット商事」→注意事項「⚠」→候補提示→ワンタップ割当（通知は記録）→実績15分→確認文案（未送信・送信は3ゲートでブロック）。

## 制御の確認（送信・受信）
- **送信は必ずブロック**：`ALLOW_OUTBOUND_SEND=false`（全体OFF）／口座 `outbound_enabled=0`（口座OFF）／未承認、のいずれかで送らない。全部満たすと送信。
  - 口座送信ON： `POST /api/channel-accounts/flags {"channel":"chatwork","identifier":"cw-pilot","outbound":true}`
- **受信は口座単位でOFF可**：`{"channel":"chatwork","identifier":"cw-pilot","inbound":false}` にすると、その口座は受信しない（保存もしない）。

## 実クライアント投入への切り替え
リハーサルOK後、`seed.pilot-rehearsal.sql` を実データ（`db/seed.your.sql`・**コミットしない**）に置き換え、実トークン・実Webhookを設定して1社から開始（`docs/TRIAL_OPERATION.md`）。

## 片付け
`npm run rehearsal` は使い捨てDBを自動削除。手動確認で使った `./data/intake.db` は削除してよい（`rm -rf data`）。
