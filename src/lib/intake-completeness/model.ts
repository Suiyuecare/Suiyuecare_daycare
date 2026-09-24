import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";

export const INTAKE_COMPLETENESS_PATH = "/app/intake-completeness";
export const CHECK_KEYS = ["identity", "birth_date", "address", "contact", "emergency_contact", "consent", "identity_front", "identity_back", "medication_bag", "medication_plan", "medication_history", "health_exam", "weekly"] as const;
export const STATES = ["complete", "missing", "pending", "not_applicable", "denied", "unknown", "expired", "replacement", "declined"] as const;
export type CheckState = typeof STATES[number];
export type CheckKey = typeof CHECK_KEYS[number];
export const CHECK_LABELS: Record<CheckKey, string> = { identity: "身分識別資料", birth_date: "出生日期", address: "居住地址", contact: "可聯繫的關係人", emergency_contact: "緊急聯絡人", consent: "告知同意確認", identity_front: "身分證正面", identity_back: "身分證反面", medication_bag: "藥袋", medication_plan: "用藥計畫", medication_history: "歷史給藥紀錄", health_exam: "體檢資料", weekly: "有效的每週到站設定" };
export const STATE_LABELS: Record<CheckState, string> = { complete: "已登錄／已覆核", missing: "待補資料", pending: "待確認／處理中", not_applicable: "已確認不適用", denied: "此帳號無查閱權限", unknown: "尚無收案版本可核對", expired: "已超過登錄效期", replacement: "需重新提供", declined: "未同意，請聯絡負責人" };
const checkSchema = z.object({ key: z.enum(CHECK_KEYS), state: z.enum(STATES) }).strict();
const rowSchema = z.object({ clientId: z.uuid(), clientCode: z.string().min(1).max(64), displayName: z.string().min(1).max(120), clientStatus: z.enum(["active", "suspended", "closed", "deceased", "transferred"]), profileVersion: z.number().int().nonnegative(), checks: z.array(checkSchema).length(CHECK_KEYS.length) }).strict().refine((row) => new Set(row.checks.map((check) => check.key)).size === CHECK_KEYS.length);
export const snapshotSchema = z.object({ organizationId: z.uuid(), branchId: z.uuid(), asOf: z.iso.date(), generatedAt: z.iso.datetime({ offset: true }), rows: z.array(rowSchema).max(500) }).strict().refine((snapshot) => new Set(snapshot.rows.map((row) => row.clientId)).size === snapshot.rows.length);
export type IntakeCompletenessSnapshot = z.infer<typeof snapshotSchema>;
export type CompletenessRow = IntakeCompletenessSnapshot["rows"][number];
export const FILTERS = ["attention", "missing", "pending", "expired", "unknown", "resolved", "all"] as const;
export type ReportFilter = typeof FILTERS[number];
export const FILTER_LABELS: Record<ReportFilter, string> = { attention: "所有待處理個案", missing: "待補／需重送", pending: "待確認／未同意", expired: "文件／週表已過期", unknown: "資料或權限待確認", resolved: "本表項目已處理", all: "全部授權個案" };
export const isResolved = (state: CheckState) => state === "complete" || state === "not_applicable";
export function canReadIntakeCompleteness(context: TenantContext) { return Boolean(context.branchId) && (context.demo || ["clients.read", "clients.demographics.read"].every((scope) => context.scopes.includes(scope))); }
export function matchesFilter(row: CompletenessRow, filter: ReportFilter) {
  if (filter === "all") return true;
  if (filter === "resolved") return row.checks.every((check) => isResolved(check.state));
  return row.checks.some(({ state }) => filter === "attention" ? !isResolved(state) : filter === "missing" ? ["missing", "replacement"].includes(state) : filter === "pending" ? ["pending", "declined"].includes(state) : filter === "unknown" ? ["unknown", "denied"].includes(state) : state === "expired");
}
export function reportCounts(snapshot: IntakeCompletenessSnapshot, query = "", item: CheckKey | "all" = "all") { return Object.fromEntries(FILTERS.map((filter) => [filter, filterRows(snapshot, filter, query, item).length])) as Record<ReportFilter, number>; }
export function hasFreshReportTimestamp(generatedAt: string, now = Date.now()) {
  const generated = Date.parse(generatedAt);
  return Number.isFinite(generated) && now - generated <= 120_000 && generated - now <= 60_000;
}
export function filterRows(snapshot: IntakeCompletenessSnapshot, filter: ReportFilter, query = "", item: CheckKey | "all" = "all") {
  const needle = query.trim().toLocaleLowerCase("zh-TW");
  return snapshot.rows.filter((row) => matchesFilter(row, filter) && (!needle || `${row.displayName} ${row.clientCode}`.toLocaleLowerCase("zh-TW").includes(needle)) && (item === "all" || row.checks.some((check) => check.key === item && !isResolved(check.state))));
}
export function intakeDrilldown(clientId: string, key: CheckKey) {
  z.uuid().parse(clientId);
  const step = key === "weekly" ? "weekly" : CHECK_KEYS.indexOf(key) >= 6 ? "documents" : "profile";
  return `/app/client-intake?${new URLSearchParams({ client: clientId, step })}`;
}
