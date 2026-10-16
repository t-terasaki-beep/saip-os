// 実行時設定。feature flag は既定OFF（安全側）。テストから書き換え可能にするため mutable。
import "dotenv/config";

const bool = (v: string | undefined, def = false) =>
  v === undefined ? def : ["1", "true", "yes", "on"].includes(v.toLowerCase());

export const config = {
  port: Number(process.env.PORT || 8787),
  env: process.env.NODE_ENV || "development",
  aiProvider: (process.env.AI_PROVIDER || "mock") as "mock" | "claude",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",

  intake: {
    chatworkEnabled: bool(process.env.CHATWORK_INGEST_ENABLED, false),
    gmailEnabled: bool(process.env.GMAIL_INGEST_ENABLED, false),
  },

  // 送信の全体スイッチ（既定OFF）。口座別 outbound_enabled と承認の3つが揃って初めて送る。
  allowOutboundSend: bool(process.env.ALLOW_OUTBOUND_SEND, false),

  overdueCheckIntervalSec: Number(process.env.OVERDUE_CHECK_INTERVAL_SEC || 300),
};
