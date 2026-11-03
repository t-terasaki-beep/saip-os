// オンライン秘書の業務カテゴリ。AI解析はこの中の1つにタスクを分類する。
export const ONLINE_SECRETARY_CATEGORIES = [
  "quotation_invoice",        // 見積・請求
  "payment_followup",         // 入金確認・督促
  "accounting_entry",         // 記帳・経費入力
  "attendance_payroll_prep",  // 勤怠・給与準備
  "executive_operations",     // 役員業務サポート
  "other",                    // その他
] as const;

export type OnlineSecretaryTaskCategory = (typeof ONLINE_SECRETARY_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<OnlineSecretaryTaskCategory, string> = {
  quotation_invoice: "請求・見積",
  payment_followup: "入金確認・督促",
  accounting_entry: "記帳・経費",
  attendance_payroll_prep: "勤怠・給与準備",
  executive_operations: "役員サポート",
  other: "その他",
};

// カテゴリ → 代表的な業務タイプ（テンプレ照合・候補スキル照合の既定）
export const CATEGORY_DEFAULT_TASK_TYPE: Record<OnlineSecretaryTaskCategory, string> = {
  quotation_invoice: "見積",
  payment_followup: "入金確認",
  accounting_entry: "経費入力",
  attendance_payroll_prep: "勤怠",
  executive_operations: "資料作成",
  other: "手配",
};
