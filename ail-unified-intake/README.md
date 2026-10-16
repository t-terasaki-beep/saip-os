# オンライン秘書OS — 統合受付・自動振り分けエンジン（ail-unified-intake）

高市さんグループ（オンライン秘書）向け。**拾う・読む・転記する・候補を探す**を自動化し、
管理者は「最終確認と例外対応」に集中できるようにする。人を増やさずに仕事を増やし、利益を残すのが狙い。

## できること（再構築した中核）
- **受付**：Chatwork Webhook ほかから依頼を取り込み、原文を保存（口座単位で受信ON/OFF）
- **AI解析（mock/claude切替）**：業務カテゴリ分類・業務タイプ・期限・不足情報・想定工数を付与
- **クライアント照合**：送信元口座から依頼元クライアントを特定
- **注意事項**：クライアント固有ルール（例：電話NG・部長CC・金額は依頼のまま）を表示
- **担当候補提示**：スキル照合で最大3名を根拠つき提示
- **手動割当**：人が確定。割当通知は外部送信OFF時は「記録のみ」
- **実績時間**：15分単位で記録（想定対実績差の集計に使う）
- **確認文案**：生成→承認→送信。**送信は3ゲート（全体OFF・口座OFF・未承認）で必ずブロック**
- **管理コンソール**：トークンログイン・タブ（統合インボックス/要確認/割当待ち/期限超過/稼働/分析）・タスク詳細ドロワー

## 安全既定（重要）
- 外部送信・返信・ファイル送付は初期状態で必ずOFF（承認なしで送らない）
- 金額はAIが確定しない（依頼記載のまま）
- 請求/入金/給与/勤怠/領収書等の個人情報・機微情報はリポジトリ/テストデータに保存しない
- 個人LINE/Messengerは非対応

## 技術構成（A案＝外部サービス不要で起動）
Node 20 + TypeScript(ESM) + Express + better-sqlite3 + zod / tsx / node:test。
本番（B案）では SQLite→Postgres、ローカルジョブ→キュー基盤へ差し替え可能。

## 使い方
```bash
npm install
cp .env.example .env          # 既定: 受信OFF・送信OFF・AI=mock
npm run migrate               # マイグレーション適用（db/migrations/*.sql）
npm run dev                   # http://localhost:8787/ 管理コンソール
npm test                      # 16 tests
npm run rehearsal             # 匿名データで通し検証（10 PASS）
```

## ディレクトリ
```
db/migrations/   スキーマ（0001_init / 0008_pilot_controls）
db/seed.pilot-rehearsal.sql  匿名フィクスチャ（実データseedはコミットしない）
src/ingest/      受付パイプライン（受信ゲート・重複排除・クライアント照合）
src/ai/          解析プロバイダ（mock / claude）
src/jobs/        ジョブキュー・ワーカー
src/assign/      担当候補・手動割当
src/analytics/   実績時間
src/drafts/      確認文案（3ゲート送信）
src/channels/    口座別 受信/送信可否・クライアント注意事項
src/store/       画面/API用クエリ
src/auth/        RBAC（admin/manager/staff）
src/metrics/     実測メトリクス（品質・速度評価は未実装）
src/web/         管理コンソール（単一HTML）
scripts/         rehearsal / seed loader
docs/            運用ドキュメント
```

## 役割（運用方針）
- **Notion＝正本**（案件・仕様・進捗・成果物）／**ローカル＝実装・検証**／**GitHub＝履歴・バックアップ・公開（必要時のみ）**
