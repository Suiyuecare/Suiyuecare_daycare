import { z } from "zod";
import { IntegrationError } from "@/lib/integrations/errors";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { DATA_INVENTORY_ITEMS, INVENTORY_SOURCES, INVENTORY_OWNERS, INVENTORY_REASONS, RECONCILIATION_STATES,
  dataInventoryReviewBlockers, type DataInventoryMutation, type DataInventoryReceipt, type DataInventorySnapshot } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const count = z.number().int().min(0).max(1_000_000_000).nullable();
const date = z.string().regex(/^(19\d{2}|20\d{2}|21\d{2}|2200)-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const timestamp = z.string().refine((value) => isStrictOffsetDateTime(value) && Number.isFinite(new Date(value).getTime()));
const itemKey = z.enum(DATA_INVENTORY_ITEMS.map((item) => item.key));
export const dataInventoryContentSchema = z.object({
  status: z.enum(["missing", "received", "not_applicable"]), source: z.enum(INVENTORY_SOURCES), accountableRole: z.enum(INVENTORY_OWNERS),
  periodStart: date.nullable(), periodEnd: date.nullable(), expectedCount: count, actualCount: count,
  missingRequired: count, unmapped: count, conflicts: count, criticalDifferences: count,
  keyFields: z.enum(RECONCILIATION_STATES), amounts: z.enum(RECONCILIATION_STATES), attachments: z.enum(RECONCILIATION_STATES),
  evidenceReference: uuid.nullable(), reasonCode: z.enum(INVENTORY_REASONS),
}).strict().superRefine((value, ctx) => {
  if ((value.periodStart === null) !== (value.periodEnd === null) ||
    (value.periodStart && value.periodEnd && value.periodStart > value.periodEnd)) ctx.addIssue({ code: "custom", message: "期間須成對且起日不得晚於迄日。" });
  if (value.status === "not_applicable" && (!["out_of_scope", "no_historical_data"].includes(value.reasonCode) ||
    [value.periodStart, value.periodEnd, value.expectedCount, value.actualCount, value.missingRequired, value.unmapped, value.conflicts, value.criticalDifferences].some((v) => v !== null) ||
    [value.keyFields, value.amounts, value.attachments].some((v) => v !== "not_applicable"))) ctx.addIssue({ code: "custom", message: "不適用須填原因，清空日期與筆數，並明確標示核對項目不適用。" });
});
export const dataInventoryMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), itemKey, expectedVersion: z.number().int().min(0).max(1_000_000), content: dataInventoryContentSchema }).strict(),
  z.object({ action: z.literal("verify"), itemKey, expectedVersion: z.number().int().min(1).max(1_000_000),
    expectedVersionId: uuid, expectedContentHash: z.string().regex(/^[0-9a-f]{64}$/u) }).strict(),
]).superRefine((value, ctx) => {
  if (value.action === "save" && value.expectedVersion > 0 && value.content.reasonCode === "none") ctx.addIssue({ code: "custom", message: "修訂須記錄原因代碼。" });
});
export const dataInventoryVersionSchema = z.object({
  versionId: uuid, objectId: uuid, itemKey, version: z.number().int().positive(), previousVersionId: uuid.nullable(),
  content: dataInventoryContentSchema, contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
  recordedBy: uuid, contentRecordedBy: uuid, createdAt: timestamp,
  reviewState: z.enum(["pending", "manually_verified"]), reviewedBy: uuid.nullable(), reviewedAt: timestamp.nullable(), reviewChallengeId: uuid.nullable(),
}).strict().superRefine((v, ctx) => {
  if ((v.version === 1) !== (v.previousVersionId === null) ||
    (v.reviewState === "pending" ? v.recordedBy !== v.contentRecordedBy || [v.reviewedBy, v.reviewedAt, v.reviewChallengeId].some((x) => x !== null)
      : v.version === 1 || !v.reviewedBy || !v.reviewedAt || !v.reviewChallengeId || v.reviewedBy === v.contentRecordedBy ||
        v.reviewedBy !== v.recordedBy || v.reviewedAt !== v.createdAt || dataInventoryReviewBlockers(v.itemKey, v.content).length > 0)) {
    ctx.addIssue({ code: "custom", message: "盤點版本或獨立覆核證據不完整。" });
  }
});
export function canonicalInventoryJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalInventoryJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalInventoryJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function parseDataInventoryMutation(value: unknown, headerKey: string | null = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new IntegrationError("INVALID_DATA_INVENTORY", "盤點內容格式不正確。", 400);
  const { idempotency_key: rawKey, ...rest } = value as Record<string, unknown>;
  const key = uuid.safeParse(rawKey); const request = dataInventoryMutationSchema.safeParse(rest);
  if (!key.success || !request.success || (headerKey !== null && headerKey.toLowerCase() !== key.data)) throw new IntegrationError(
    "INVALID_DATA_INVENTORY", "盤點欄位、日期、原因或操作識別碼未通過驗證；不得填寫個資。", 400);
  return { request: request.data as DataInventoryMutation, idempotencyKey: key.data };
}
const receiptSchema = z.object({ operationId: uuid, organizationId: uuid, branchId: uuid, actorUserId: uuid,
  idempotencyKey: uuid, request: dataInventoryMutationSchema, result: dataInventoryVersionSchema, replayed: z.boolean() }).strict();
export function parseDataInventoryReceipt(value: unknown, expected: {
  request: DataInventoryMutation; idempotencyKey: string; organizationId: string; branchId: string; actorUserId: string;
}, httpStatus?: number): DataInventoryReceipt {
  const parsed = receiptSchema.safeParse(value);
  const invalid = () => { throw new IntegrationError("DATA_INVENTORY_RECEIPT_INVALID", "完成憑證尚未確認，請保留相同內容與識別碼重試。", 502); };
  if (!parsed.success) return invalid();
  const data = parsed.data; const input = expected.request; const result = data.result;
  if (data.organizationId !== expected.organizationId || data.branchId !== expected.branchId ||
    data.actorUserId !== expected.actorUserId || data.idempotencyKey !== expected.idempotencyKey ||
    canonicalInventoryJson(data.request) !== canonicalInventoryJson(input) || result.itemKey !== input.itemKey ||
    result.version !== input.expectedVersion + 1 || result.recordedBy !== expected.actorUserId ||
    result.reviewState !== (input.action === "verify" ? "manually_verified" : "pending") ||
    (input.action === "verify" && (result.previousVersionId !== input.expectedVersionId || result.contentHash !== input.expectedContentHash)) ||
    (input.action === "save" && canonicalInventoryJson(result.content) !== canonicalInventoryJson(input.content)) ||
    (httpStatus !== undefined && httpStatus !== (data.replayed ? 200 : 201))) return invalid();
  return data;
}
export function parseDataInventoryActionSuccess(value: unknown, expected: Parameters<typeof parseDataInventoryReceipt>[1], httpStatus: number) {
  const parsed = z.object({ requestId: uuid, status: z.literal("ok"), data: z.unknown(), errors: z.tuple([]) }).strict().safeParse(value);
  if (!parsed.success) throw new IntegrationError("DATA_INVENTORY_RECEIPT_INVALID", "尚未收到有效完成憑證，請以相同識別碼重試。", 502);
  return parseDataInventoryReceipt(parsed.data.data, expected, httpStatus);
}
const snapshotSchema = z.object({ organizationId: uuid, branchId: uuid, generatedAt: timestamp, staleAfter: timestamp,
  records: z.array(z.object({ itemKey, current: dataInventoryVersionSchema, history: z.array(dataInventoryVersionSchema).min(1).max(20),
    historyTotal: z.number().int().positive(), historyTruncated: z.boolean() }).strict()).max(12),
  demo: z.boolean(), verificationKind: z.literal("manual_metadata_only"), formalPromotionStatus: z.literal("not_configured") }).strict();
export function projectDataInventorySnapshot(value: unknown, organizationId: string, branchId: string): DataInventorySnapshot {
  const data = snapshotSchema.parse(value);
  const generated = new Date(data.generatedAt).getTime(); const stale = new Date(data.staleAfter).getTime();
  if (data.demo || data.organizationId !== organizationId || data.branchId !== branchId || generated > Date.now() + 60_000 ||
    stale <= Date.now() || stale - generated !== 300_000 || new Set(data.records.map((r) => r.itemKey)).size !== data.records.length ||
    data.records.some((r) => r.current.itemKey !== r.itemKey || r.current.version !== r.historyTotal ||
      canonicalInventoryJson(r.current) !== canonicalInventoryJson(r.history[0]) || r.historyTotal < r.history.length ||
      r.historyTruncated !== (r.historyTotal > r.history.length) || r.history.some((v, index) => {
        const prior = r.history[index + 1];
        return v.itemKey !== r.itemKey || v.objectId !== r.current.objectId || v.version !== r.current.version - index ||
          (prior ? v.previousVersionId !== prior.versionId || new Date(prior.createdAt).getTime() > new Date(v.createdAt).getTime() ||
            (v.reviewState === "manually_verified" && (prior.reviewState !== "pending" || v.contentRecordedBy !== prior.contentRecordedBy || v.contentHash !== prior.contentHash || canonicalInventoryJson(v.content) !== canonicalInventoryJson(prior.content)))
            : !r.historyTruncated && v.previousVersionId !== null);
      }))) throw new Error("DATA_INVENTORY_SNAPSHOT_INVALID");
  return data;
}
