// 短いユニークID生成（依存を増やさないため crypto.randomUUID ベース）。
import { randomUUID } from "node:crypto";

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
