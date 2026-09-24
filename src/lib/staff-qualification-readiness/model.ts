export const QUALIFICATION_ISSUES = [
  "expired", "due_soon", "registration", "verification", "evidence",
  "unknown_expiry", "not_effective", "missing_record",
] as const;
export type QualificationIssue = (typeof QUALIFICATION_ISSUES)[number];
export type QualificationFilter = "all" | QualificationIssue;
export type QualificationFilters = { issue: QualificationFilter; staff: string | null; query: string };
export const QUALIFICATION_LABELS: Record<QualificationIssue, string> = {
  expired: "已過期", due_soon: "30 日內到期", registration: "登錄待處理",
  verification: "核驗待處理", evidence: "證明待補", unknown_expiry: "到期日待確認",
  not_effective: "尚未生效", missing_record: "未建有效證照紀錄",
};
export type QualificationRow = {
  key: string; staffMembershipId: string; staffName: string; employeeCode: string | null;
  certificateType: string | null; certificateVersion: number | null;
  effectiveOn: string | null; expiresOn: string | null;
  daysToExpiry: number | null; issues: QualificationIssue[]; actionHref: string;
};
export type QualificationReport = {
  organizationId: string; branchId: string; branchName: string;
  generatedAt: string; snapshotDate: string; staleAfter: string; dueThrough: string;
  filters: QualificationFilters; rows: QualificationRow[];
  counts: Record<QualificationIssue, number>; totalRows: number;
  visibleCurrentStaff: number; incomplete: boolean; missingRecordsKnown: boolean;
  sourceRecordTotal: number; sourceRecordCount: number;
  staffOptions: { id: string; name: string }[];
  serviceEligibility: "not_evaluated"; demo: boolean;
};
