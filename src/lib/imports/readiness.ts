import type { ImportPreviewField, ImportSection, ImportWarning } from "./types";

export type ImportReadinessInput = {
  fields: ImportPreviewField[];
  sections: ImportSection[];
  warnings: ImportWarning[];
  conflictCount: number;
  mappingVersion: string;
};

export type ImportFieldFilter = "all" | "mapped" | "unknown" | "conflict";

/** These are parser observations only, never an authorization or promotion decision. */
export function summarizeImportReadiness(input: ImportReadinessInput) {
  const counts = { mapped: 0, unknown: 0, conflict: 0 };
  for (const field of input.fields) counts[field.mappingState] += 1;
  const unrecognizedSections = input.sections.filter((section) => !section.recognized).length;
  const errorWarnings = input.warnings.filter((warning) => warning.severity === "error").length;
  const hasOpenParserIssues = input.fields.length === 0 || counts.unknown > 0 || counts.conflict > 0 ||
    input.conflictCount > 0 || unrecognizedSections > 0 || errorWarnings > 0;
  return {
    fieldTotal: input.fields.length,
    ...counts,
    sectionTotal: input.sections.length,
    unrecognizedSections,
    conflictGroups: input.conflictCount,
    warningTotal: input.warnings.length,
    errorWarnings,
    hasOpenParserIssues,
    // A clean parse cannot establish identity, ownership, retention or transaction evidence.
    canPromote: false as const,
    status: hasOpenParserIssues ? "needs_review" as const : "parsed_only" as const,
  };
}

export function filterImportReadinessFields(
  fields: ImportPreviewField[], status: ImportFieldFilter, sectionId: string,
) {
  return fields.filter((field) => (status === "all" || field.mappingState === status) &&
    (sectionId === "all" || field.source.parentPath === sectionId));
}

export const IMPORT_PROMOTION_GATES = [
  { id: "identity", title: "穩定個案識別與有效期間", reason: "需以識別碼核對個案；不得依姓名自動合併。", owner: "機構提供與確認，工程端驗證" },
  { id: "mapping", title: "正式業務欄位與資料主權", reason: "候選來源路徑不等於已寫入個案、計畫或服務資料表。", owner: "工程實作＋業務覆核" },
  { id: "archive", title: "原始檔與附件安全封存", reason: "WORM 保存、附件掃毒及雜湊對帳尚待正式環境證據。", owner: "工程端與資料治理負責人" },
  { id: "transaction", title: "核准、寫入與失敗回復", reason: "需驗證近期 MFA、逐欄衝突處理及單一交易；暫存核准不能當作正式匯入。", owner: "工程端驗證＋授權人員核准" },
] as const;
