// 決定論的なモック解析（APIキー不要）。キーワードでカテゴリ・業務タイプ・期限・不足情報を推定。
import type { Analyzer, Analysis } from "./types.js";
import type { OnlineSecretaryTaskCategory } from "../online_secretary/category.js";
import { CATEGORY_DEFAULT_TASK_TYPE } from "../online_secretary/category.js";

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

// キーワード → カテゴリ＋業務タイプ。先に一致したものを採用。
const RULES: { re: RegExp; category: OnlineSecretaryTaskCategory; task_type: string }[] = [
  { re: /(見積|御見積|お見積|estimate)/, category: "quotation_invoice", task_type: "見積" },
  { re: /(請求|invoice|請求書)/, category: "quotation_invoice", task_type: "請求書" },
  { re: /(入金|振込|未入金|督促|支払.?確認)/, category: "payment_followup", task_type: "入金確認" },
  { re: /(経費|記帳|仕訳|領収書)/, category: "accounting_entry", task_type: "経費入力" },
  { re: /(勤怠|給与|シフト|タイムカード)/, category: "attendance_payroll_prep", task_type: "勤怠" },
  { re: /(議事録|日程調整|アポ|役員|取締役|資料作成|資料を作成)/, category: "executive_operations", task_type: "資料作成" },
];

function detectDeadline(body: string, receivedAt: number): number | null {
  // 「明日」「今日中」「M月D日」などの軽い抽出（Asia/Tokyo基準）。
  const base = new Date(receivedAt + TOKYO_OFFSET_MS);
  const y = base.getUTCFullYear();
  const md = body.match(/(\d{1,2})月(\d{1,2})日/);
  if (md) {
    const dt = Date.UTC(y, Number(md[1]) - 1, Number(md[2]), 9, 0, 0) - TOKYO_OFFSET_MS;
    return dt;
  }
  if (/今日中|本日中/.test(body)) {
    const dt = Date.UTC(y, base.getUTCMonth(), base.getUTCDate(), 18, 0, 0) - TOKYO_OFFSET_MS;
    return dt;
  }
  if (/明日/.test(body)) {
    const dt = Date.UTC(y, base.getUTCMonth(), base.getUTCDate() + 1, 18, 0, 0) - TOKYO_OFFSET_MS;
    return dt;
  }
  return null;
}

function detectMissing(body: string, category: OnlineSecretaryTaskCategory): string[] {
  const miss: string[] = [];
  if (category === "quotation_invoice") {
    if (!/宛名|御中|様|会社名/.test(body)) miss.push("宛名（請求先・会社名）");
    if (!/品目|項目|内容|商品/.test(body)) miss.push("品目・内容");
    if (!/数量|個|点|式/.test(body)) miss.push("数量");
    if (!/金額|円|¥|税/.test(body)) miss.push("金額（依頼記載のまま。当方で確定しない）");
  }
  if (!/(期限|まで|日|締切)/.test(body)) miss.push("希望期限");
  return miss;
}

export class MockAnalyzer implements Analyzer {
  readonly name = "mock";
  async analyze(input: { body: string; receivedAt: number; channel: string }): Promise<Analysis> {
    const body = input.body || "";
    const rule = RULES.find((r) => r.re.test(body));
    const category: OnlineSecretaryTaskCategory = rule?.category ?? "other";
    const task_type = rule?.task_type ?? CATEGORY_DEFAULT_TASK_TYPE[category];
    const priority = /(至急|緊急|urgent|今日中|本日中)/.test(body) ? "urgent"
      : /(なるべく早く|お早め|急ぎ)/.test(body) ? "high" : "normal";
    const deadline_at = detectDeadline(body, input.receivedAt);
    const missing_info = detectMissing(body, category);
    const titleBase = body.replace(/\s+/g, " ").trim().slice(0, 40) || "(本文なし)";
    const confidence = rule ? 0.85 : 0.4;
    return { title: titleBase, category, task_type, priority, deadline_at, missing_info, confidence };
  }
}
