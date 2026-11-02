// Anthropic Messages API を使う解析（AI_PROVIDER=claude のとき）。
// APIキーが無い/失敗時はモックにフォールバックして受付を止めない。
import type { Analyzer, Analysis } from "./types.js";
import { MockAnalyzer } from "./mock.js";
import { config } from "../config.js";
import { ONLINE_SECRETARY_CATEGORIES } from "../online_secretary/category.js";

const SYSTEM = `あなたはオンライン秘書業務の受付解析器です。日本語の依頼メッセージを読み、JSONのみを返します。
金額は確定しないこと（依頼記載のまま）。出力スキーマ:
{"title":string,"category":one of ${JSON.stringify(ONLINE_SECRETARY_CATEGORIES)},
 "task_type":string,"priority":"low"|"normal"|"high"|"urgent",
 "deadline_hint":string|null,"missing_info":string[],"confidence":number}`;

export class ClaudeAnalyzer implements Analyzer {
  readonly name = "claude";
  private fallback = new MockAnalyzer();

  async analyze(input: { body: string; receivedAt: number; channel: string }): Promise<Analysis> {
    if (!config.anthropicApiKey) return this.fallback.analyze(input);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.anthropicApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-5-5",
          max_tokens: 512,
          system: SYSTEM,
          messages: [{ role: "user", content: input.body }],
        }),
      });
      if (!res.ok) return this.fallback.analyze(input);
      const data: any = await res.json();
      const text = data?.content?.[0]?.text ?? "{}";
      const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      // deadline_hint は文章なので、確実な ms 変換はモックの抽出に委ねる
      const mock = await this.fallback.analyze(input);
      return {
        title: parsed.title ?? mock.title,
        category: ONLINE_SECRETARY_CATEGORIES.includes(parsed.category) ? parsed.category : mock.category,
        task_type: parsed.task_type ?? mock.task_type,
        priority: parsed.priority ?? mock.priority,
        deadline_at: mock.deadline_at,
        missing_info: Array.isArray(parsed.missing_info) ? parsed.missing_info : mock.missing_info,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : mock.confidence,
      };
    } catch {
      return this.fallback.analyze(input);
    }
  }
}
