import type { OnlineSecretaryTaskCategory } from "../online_secretary/category.js";

// AI解析の出力。金額は確定しない（依頼記載のまま）方針なので amount は持たない。
export interface Analysis {
  title: string;
  category: OnlineSecretaryTaskCategory;
  task_type: string;                 // テンプレ照合用（請求書 / 見積 / 入金確認 ...）
  priority: "low" | "normal" | "high" | "urgent";
  deadline_at: number | null;        // epoch ms（Asia/Tokyo基準で解釈）
  missing_info: string[];            // 不足情報（人が確認すべき点）
  confidence: number;                // 0..1
}

export interface Analyzer {
  readonly name: string;
  analyze(input: { body: string; receivedAt: number; channel: string }): Promise<Analysis>;
}
