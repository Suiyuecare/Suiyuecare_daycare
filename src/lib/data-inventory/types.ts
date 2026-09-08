export const DATA_INVENTORY_ITEMS = [
  { key: "client_master", category: "個案與授權", label: "個案基本資料", source: "中央 HTML／舊系統" },
  { key: "consents", category: "個案與授權", label: "關係人與告知同意", source: "機構同意文件" },
  { key: "authorized_plans", category: "核定與照顧計畫", label: "資格與核定計畫", source: "中央 HTML／核定文件" },
  { key: "care_execution", category: "實際服務", label: "每日照顧與評估", source: "舊系統／照顧表單" },
  { key: "medication", category: "實際服務", label: "醫囑與用藥執行", source: "有效醫囑／用藥紀錄" },
  { key: "attendance_transport", category: "實際服務", label: "出勤與交通", source: "出勤／接送紀錄" },
  { key: "billing", category: "帳務與申報", label: "帳單與收付款", source: "財務明細" },
  { key: "claims", category: "帳務與申報", label: "申報與回覆", source: "申報匯出／回覆檔" },
  { key: "organization", category: "機構與員工", label: "機構與營運設定", source: "許可／營運資料" },
  { key: "staff", category: "機構與員工", label: "員工與資格", source: "員工／資格清冊" },
  { key: "forms_rules", category: "表單與歷史證據", label: "表單與規則版本", source: "核准範本／規則" },
  { key: "history_attachments", category: "表單與歷史證據", label: "歷史紀錄與附件", source: "歷史匯出／附件清冊" },
] as const;
export type DataInventoryItemKey = (typeof DATA_INVENTORY_ITEMS)[number]["key"];
export const INVENTORY_SOURCES = ["unknown", "central_html", "previous_system", "spreadsheet", "paper", "organization_file"] as const;
export const INVENTORY_OWNERS = ["unassigned", "organization_manager", "branch_supervisor", "case_manager_social_worker", "nurse", "finance_claims"] as const;
export const INVENTORY_REASONS = ["none", "out_of_scope", "no_historical_data", "data_correction", "source_updated"] as const;
export const RECONCILIATION_STATES = ["pending", "passed", "not_applicable"] as const;
export type DataInventoryContent = {
  status: "missing" | "received" | "not_applicable";
  source: (typeof INVENTORY_SOURCES)[number]; accountableRole: (typeof INVENTORY_OWNERS)[number];
  periodStart: string | null; periodEnd: string | null;
  expectedCount: number | null; actualCount: number | null;
  missingRequired: number | null; unmapped: number | null; conflicts: number | null; criticalDifferences: number | null;
  keyFields: (typeof RECONCILIATION_STATES)[number]; amounts: (typeof RECONCILIATION_STATES)[number]; attachments: (typeof RECONCILIATION_STATES)[number];
  evidenceReference: string | null; reasonCode: (typeof INVENTORY_REASONS)[number];
};
export type DataInventoryVersion = {
  versionId: string; objectId: string; itemKey: DataInventoryItemKey; version: number;
  previousVersionId: string | null; content: DataInventoryContent; contentHash: string;
  recordedBy: string; contentRecordedBy: string; createdAt: string;
  reviewState: "pending" | "manually_verified"; reviewedBy: string | null;
  reviewedAt: string | null; reviewChallengeId: string | null;
};
export type DataInventorySnapshot = {
  organizationId: string; branchId: string; generatedAt: string; staleAfter: string;
  records: { itemKey: DataInventoryItemKey; current: DataInventoryVersion; history: DataInventoryVersion[]; historyTotal: number; historyTruncated: boolean }[];
  demo: boolean; verificationKind: "manual_metadata_only"; formalPromotionStatus: "not_configured";
};
export type DataInventoryMutation = {
  action: "save"; itemKey: DataInventoryItemKey; expectedVersion: number; content: DataInventoryContent;
} | { action: "verify"; itemKey: DataInventoryItemKey; expectedVersion: number; expectedVersionId: string; expectedContentHash: string };
export type DataInventoryReceipt = {
  operationId: string; organizationId: string; branchId: string; actorUserId: string;
  idempotencyKey: string; request: DataInventoryMutation; result: DataInventoryVersion; replayed: boolean;
};
export function emptyDataInventoryContent(): DataInventoryContent {
  return { status: "missing", source: "unknown", accountableRole: "unassigned", periodStart: null, periodEnd: null,
    expectedCount: null, actualCount: null, missingRequired: null, unmapped: null, conflicts: null,
    criticalDifferences: null, keyFields: "pending", amounts: "pending", attachments: "pending", evidenceReference: null, reasonCode: "none" };
}
/** This is manual checklist eligibility, never a formal-data or release readiness assertion. */
export function dataInventoryReviewBlockers(itemKey: DataInventoryItemKey, content: DataInventoryContent): string[] {
  const result: string[] = [];
  if (content.status === "missing") result.push("尚未取得來源資料");
  if (content.source === "unknown") result.push("尚未確認資料來源");
  if (content.accountableRole === "unassigned") result.push("尚未指定資料負責角色");
  if (!content.evidenceReference) result.push("缺少人工對帳證據參照碼");
  if (content.status === "not_applicable") {
    if (!["out_of_scope", "no_historical_data"].includes(content.reasonCode)) result.push("不適用須附原因代碼");
    return result;
  }
  if (!content.periodStart || !content.periodEnd) result.push("資料涵蓋期間未完整");
  if (content.expectedCount === null || content.actualCount === null) result.push("來源與實際筆數尚未盤點");
  else if (content.expectedCount !== content.actualCount) result.push("來源與實際筆數不一致");
  for (const [key, label] of [["missingRequired", "必要欄位缺漏"], ["unmapped", "未映射欄位"], ["conflicts", "待處理衝突"], ["criticalDifferences", "重大差異"]] as const) {
    if (content[key] !== 0) result.push(`${label}尚未確認為零`);
  }
  if (content.keyFields !== "passed") result.push("關鍵欄位人工核對未通過");
  if (content.amounts === "pending" || (["billing", "claims"].includes(itemKey) && content.amounts !== "passed")) result.push("金額人工核對未完成");
  if (content.attachments === "pending" || (itemKey === "history_attachments" && content.attachments !== "passed")) result.push("附件人工核對未完成");
  if ((content.amounts === "not_applicable" || content.attachments === "not_applicable") && !["out_of_scope", "no_historical_data"].includes(content.reasonCode)) result.push("不適用核對項目須附適用範圍或無歷史資料原因");
  return result;
}
