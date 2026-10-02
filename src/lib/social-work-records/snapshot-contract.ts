import { projectSocialWorkRecordSnapshot } from "./projection";
import type { SocialWorkRecordSnapshot } from "./types";

const topKeys = ["organizationId", "branchId", "generatedAt", "staleAfter", "records", "recordTotal", "matchingTotal", "recordsTruncated", "metrics", "clientOptions", "clientOptionsTruncated", "serviceTypeOptions", "serviceTypeOptionsTruncated", "authorOptions", "authorOptionsTruncated", "offlineSyncStatus", "followUpNotificationStatus", "demo"];
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_SOCIAL_WORK_SNAPSHOT");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new Error("INVALID_SOCIAL_WORK_SNAPSHOT");
}
function snake(value: unknown, overrides: Record<string, string> = {}) {
  const source = object(value);
  return Object.fromEntries(Object.entries(source).map(([key, entry]) => [overrides[key] ?? key.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`), entry]));
}
/** Reuse the audited projection's shape, chronology, count and lifecycle rules.
 * Unknown properties survive reencoding and are rejected, never silently lost. */
export function normalizeSocialWorkSnapshot(value: unknown, scope: { organizationId: string; branchId: string }): SocialWorkRecordSnapshot {
  const input = object(value); exact(input, topKeys);
  const metrics = object(input.metrics); exact(metrics, ["currentMonth", "pendingFollowUp", "overdueFollowUp", "drafts", "signed"]);
  if (!Array.isArray(input.records) || !Array.isArray(input.clientOptions) || !Array.isArray(input.authorOptions) || !Array.isArray(input.serviceTypeOptions) || typeof input.demo !== "boolean") throw new Error("INVALID_SOCIAL_WORK_SNAPSHOT");
  const sourceRecords = input.records;
  const records = input.records.map((value) => {
    const record = object(value);
    const derived = ["versionHistoryTruncated", "followUpHistoryTruncated"];
    if (derived.some((key) => typeof record[key] !== "boolean") || !Array.isArray(record.versionHistory) || !Array.isArray(record.followUpHistory)) throw new Error("INVALID_SOCIAL_WORK_SNAPSHOT");
    const row = snake(Object.fromEntries(Object.entries(record).filter(([key]) => !derived.includes(key))));
    row.version_history = record.versionHistory.map((entry) => snake(entry));
    row.follow_up_history = record.followUpHistory.map((entry) => snake(entry, { status: "follow_up_status", plan: "follow_up_plan", outcome: "follow_up_outcome" }));
    return row;
  });
  const result = projectSocialWorkRecordSnapshot({ expectedOrganizationId: scope.organizationId, expectedBranchId: scope.branchId, demo: input.demo, row: {
    organization_id: input.organizationId, branch_id: input.branchId, generated_at: input.generatedAt,
    records, record_total: input.recordTotal, matching_total: input.matchingTotal, records_truncated: input.recordsTruncated,
    current_month_total: metrics.currentMonth, pending_follow_up_total: metrics.pendingFollowUp, overdue_follow_up_total: metrics.overdueFollowUp,
    draft_total: metrics.drafts, signed_total: metrics.signed,
    client_options: input.clientOptions.map((entry) => snake(entry)), client_total: input.clientOptions.length + (input.clientOptionsTruncated === true ? 1 : 0), client_options_truncated: input.clientOptionsTruncated,
    service_type_options: input.serviceTypeOptions, service_type_total: input.serviceTypeOptions.length + (input.serviceTypeOptionsTruncated === true ? 1 : 0), service_type_options_truncated: input.serviceTypeOptionsTruncated,
    author_options: input.authorOptions.map((entry) => snake(entry)), author_total: input.authorOptions.length + (input.authorOptionsTruncated === true ? 1 : 0), author_options_truncated: input.authorOptionsTruncated,
    offline_sync_status: input.offlineSyncStatus, follow_up_notification_status: input.followUpNotificationStatus,
  } });
  if (result.staleAfter !== input.staleAfter || result.records.some((record, index) => record.versionHistoryTruncated !== object(sourceRecords[index]).versionHistoryTruncated || record.followUpHistoryTruncated !== object(sourceRecords[index]).followUpHistoryTruncated)) throw new Error("INVALID_SOCIAL_WORK_SNAPSHOT");
  return result;
}
