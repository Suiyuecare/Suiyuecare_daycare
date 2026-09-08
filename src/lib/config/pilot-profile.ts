/** Planning metadata, not an authenticated tenant, permit, contract, or executable rule. */
export const pilotProfile = {
  profileKey: "suiyue-wanhua-taipei",
  legalName: "樂齡歲悅股份有限公司附設臺北市私立歲悅萬華社區長照機構",
  displayName: "歲悅萬華",
  municipality: "臺北市",
  plannedServiceType: "community_day_care",
  confirmation: { source: "user_confirmation", confirmedOn: "2026-09-08" },
  provisioningStatus: "not_provisioned",
  organizationId: null,
  branchId: null,
  governmentInstitutionCode: null,
  permitNumber: null,
  contractNumber: null,
  approvedCapacity: null,
  publishedClaimFormatVersion: null,
  publishedAccreditationVersion: null,
  publishedRateVersion: null,
} as const;

export const pilotReadinessRequirements = [
  { id: "permit", label: "設立許可、機構代碼與核定服務／容量", status: "awaiting_documents" },
  { id: "contract", label: "現行特約契約、申報輸出與回覆檔去識別樣本", status: "awaiting_documents" },
  { id: "accreditation", label: "上次評鑑結果與效期、實際受評通知", status: "awaiting_documents" },
  { id: "review", label: "表單、費率、規則版本與業務／法遵雙人覆核", status: "not_approved" },
  { id: "infrastructure", label: "東京區域付費環境、DPA、WORM 與正式權限驗收", status: "not_approved" },
] as const;
