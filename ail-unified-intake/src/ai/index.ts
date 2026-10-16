// プロバイダ抽象：env AI_PROVIDER で mock / claude を切り替える。
import type { Analyzer } from "./types.js";
import { MockAnalyzer } from "./mock.js";
import { ClaudeAnalyzer } from "./claude.js";
import { config } from "../config.js";

let _analyzer: Analyzer | null = null;

export function getAnalyzer(): Analyzer {
  if (_analyzer) return _analyzer;
  _analyzer = config.aiProvider === "claude" ? new ClaudeAnalyzer() : new MockAnalyzer();
  return _analyzer;
}

export type { Analyzer, Analysis } from "./types.js";
