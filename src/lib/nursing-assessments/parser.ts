import { z } from "zod";
import { IntegrationError } from "@/lib/integrations/errors";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { NURSING_FORM_VERSION, type NursingRequest, type NursingReceipt } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const text = (max: number) => z.string().trim().min(1).max(max).refine(
  (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
);
const date = z.string().regex(/^(20\d{2}|21\d{2}|2200)-\d{2}-\d{2}$/u).refine(
  (value) => {
    const parsed = new Date(`${value}T12:00:00+08:00`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  },
);
const timestamp = z.string().refine((value) => isStrictOffsetDateTime(value) &&
  Number.isFinite(new Date(value).getTime()));
const state = z.enum(["recorded", "missing", "not_applicable"]);
export const nursingFieldSchema = z.object({
  state, detail: text(5000).nullable(), reason: text(1000).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.state === "recorded" ? value.detail === null || value.reason !== null
    : value.detail !== null || value.reason === null) {
    ctx.addIssue({ code: "custom", message: "已記錄須填內容；缺值與不適用須填理由且清空內容。" });
  }
});
export const nursingContentSchema = z.object({
  formVersionReference: z.literal(NURSING_FORM_VERSION), assessedOn: date,
  domains: z.object({ observations: nursingFieldSchema, problems: nursingFieldSchema,
    measures: nursingFieldSchema, response: nursingFieldSchema }).strict(),
  reassessment: z.object({ state, dueOn: date.nullable(), reason: text(1000) }).strict(),
}).strict().superRefine((value, ctx) => {
  const due = value.reassessment;
  if (due.state === "recorded" ? due.dueOn === null || due.dueOn < value.assessedOn : due.dueOn !== null) {
    ctx.addIssue({ code: "custom", path: ["reassessment"], message: "已排定複評須填不早於評估的日期；其餘狀態不得夾帶日期。" });
  }
});
const existing = { clientId: uuid, assessmentKey: uuid, previousVersionId: uuid,
  expectedVersion: z.number().int().positive().safe(), expectedContentHash: hash };
export const nursingRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_draft"), clientId: uuid, content: nursingContentSchema }).strict(),
  z.object({ action: z.literal("revise_draft"), ...existing, content: nursingContentSchema }).strict(),
  z.object({ action: z.literal("sign"), ...existing }).strict(),
  z.object({ action: z.literal("correct"), ...existing, content: nursingContentSchema, correctionReason: text(1000) }).strict(),
]);
export const nursingVersionSchema = z.object({
  versionId: uuid, assessmentKey: uuid, version: z.number().int().positive(),
  previousVersionId: uuid.nullable(), state: z.enum(["draft", "signed", "corrected"]),
  content: nursingContentSchema, contentHash: hash, previousContentHash: hash.nullable(),
  recordedBy: uuid, recorderDisplayName: text(120), correctionReason: text(1000).nullable(),
  signedAt: timestamp.nullable(), signedBy: uuid.nullable(), signerDisplayName: text(120).nullable(),
  signaturePurpose: text(120).nullable(), signatureChallengeId: uuid.nullable(), createdAt: timestamp,
}).strict().superRefine((value, ctx) => {
  const signature = [value.signedAt, value.signedBy, value.signerDisplayName,
    value.signaturePurpose, value.signatureChallengeId];
  if ((value.state === "draft" ? signature.some((item) => item !== null) : signature.some((item) => item === null)) ||
      (value.state !== "draft" && (value.signedBy !== value.recordedBy || value.signedAt !== value.createdAt ||
        value.signaturePurpose !== (value.state === "signed" ? "人工護理評估簽署" : "人工護理評估更正簽署"))) ||
      (value.state === "corrected" ? value.correctionReason === null : value.correctionReason !== null) ||
      (value.version === 1 ? value.previousVersionId !== null || value.previousContentHash !== null || value.state !== "draft"
        : value.previousVersionId === null || value.previousContentHash === null)) {
    ctx.addIssue({ code: "custom", message: "版本鏈或簽署證據不完整。" });
  }
});
const receiptSchema = z.object({
  operationId: uuid, organizationId: uuid, branchId: uuid, actorUserId: uuid,
  idempotencyKey: uuid, request: nursingRequestSchema, result: nursingVersionSchema,
  replayed: z.boolean(), persisted: z.literal(true), demo: z.literal(false),
}).strict();

export function canonicalNursingJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalNursingJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalNursingJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function parseNursingRequest(value: unknown, key: string | null) {
  const request = nursingRequestSchema.safeParse(value);
  const idempotencyKey = uuid.safeParse(key);
  if (!request.success || !idempotencyKey.success) throw new IntegrationError(
    "INVALID_NURSING_ASSESSMENT", "護理內容、明確缺值理由、日期、版本或操作識別碼未通過驗證。", 400,
  );
  return { request: request.data as NursingRequest, idempotencyKey: idempotencyKey.data };
}
export function parseNursingReceipt(value: unknown, expected: {
  request: NursingRequest; idempotencyKey: string; organizationId: string; branchId: string; actorUserId: string;
}, httpStatus?: number): NursingReceipt {
  const parsed = receiptSchema.safeParse(value);
  const invalid = () => { throw new IntegrationError("NURSING_RECEIPT_INVALID",
    "完成憑證與本次護理內容不一致；請保留畫面內容，以相同操作識別碼重試。", 502); };
  if (!parsed.success) return invalid();
  const data = parsed.data;
  const input = expected.request;
  const result = data.result;
  if (data.organizationId !== expected.organizationId || data.branchId !== expected.branchId ||
      data.actorUserId !== expected.actorUserId || data.idempotencyKey !== expected.idempotencyKey ||
      canonicalNursingJson(data.request) !== canonicalNursingJson(input) ||
      result.recordedBy !== expected.actorUserId ||
      result.state !== (input.action === "sign" ? "signed" : input.action === "correct" ? "corrected" : "draft") ||
      result.version !== (input.action === "create_draft" ? 1 : input.expectedVersion + 1) ||
      (input.action !== "create_draft" && (result.assessmentKey !== input.assessmentKey ||
        result.previousVersionId !== input.previousVersionId || result.previousContentHash !== input.expectedContentHash)) ||
      ("content" in input && canonicalNursingJson(result.content) !== canonicalNursingJson(input.content)) ||
      (input.action === "correct" && result.correctionReason !== input.correctionReason) ||
      (result.state !== "draft" && result.signedBy !== expected.actorUserId) ||
      (httpStatus !== undefined && httpStatus !== (data.replayed ? 200 : 201))) return invalid();
  return data;
}
export const nursingSnapshotSchema = z.object({
  organizationId: uuid, branchId: uuid, generatedAt: timestamp, staleAfter: timestamp,
  clients: z.array(z.object({ clientId: uuid, displayName: text(120),
    serviceStatus: z.enum(["active", "suspended", "transferred", "closed", "deceased"]),
    versions: z.array(nursingVersionSchema).max(50), versionsTotal: z.number().int().nonnegative(),
    versionsTruncated: z.boolean() }).strict()).max(100),
  clientTotal: z.number().int().nonnegative(), clientsTruncated: z.boolean(),
  officialScoreStatus: z.literal("not_configured"), attachmentStatus: z.literal("not_configured"),
  exportStatus: z.literal("not_configured"), notificationStatus: z.literal("not_configured"),
  offlineStatus: z.literal("not_configured"), demo: z.boolean(),
}).strict();

export function parseNursingActionSuccess(value: unknown, expected: Parameters<typeof parseNursingReceipt>[1], httpStatus: number) {
  const envelope = z.object({ requestId: uuid, status: z.literal("ok"), data: z.unknown(), errors: z.tuple([]) }).strict().safeParse(value);
  if (!envelope.success) throw new IntegrationError("NURSING_RECEIPT_INVALID", "尚未收到有效完成憑證，請保留內容並以相同識別碼重試。", 502);
  return parseNursingReceipt(envelope.data.data, expected, httpStatus);
}

export function projectNursingAssessmentSnapshot(value: unknown, organizationId: string, branchId: string) {
  const snapshot = nursingSnapshotSchema.parse(value);
  const generated = new Date(snapshot.generatedAt).getTime();
  const stale = new Date(snapshot.staleAfter).getTime();
  if (snapshot.demo || snapshot.organizationId !== organizationId || snapshot.branchId !== branchId ||
    generated > Date.now() + 60000 || stale <= Date.now() || stale - generated !== 300000 ||
    snapshot.clientTotal < snapshot.clients.length || snapshot.clientsTruncated !== (snapshot.clientTotal > snapshot.clients.length) ||
    new Set(snapshot.clients.map((client) => client.clientId)).size !== snapshot.clients.length ||
    snapshot.clients.some((client) => client.versionsTotal < client.versions.length ||
      client.versionsTruncated !== (client.versionsTotal > client.versions.length) ||
      new Set(client.versions.map((version) => version.versionId)).size !== client.versions.length ||
      client.versions.some((version, index) => {
        const prior = client.versions.find((item) => item.versionId === version.previousVersionId);
        const last = client.versions[index - 1];
        return (last && new Date(last.createdAt).getTime() < new Date(version.createdAt).getTime()) ||
          (version.previousVersionId !== null && !prior && !client.versionsTruncated) ||
          (prior && (prior.assessmentKey !== version.assessmentKey || prior.version + 1 !== version.version ||
            prior.contentHash !== version.previousContentHash ||
            new Date(prior.createdAt).getTime() > new Date(version.createdAt).getTime() ||
            (version.state === "draft" && prior.state !== "draft") ||
            (version.state === "corrected" && prior.state === "draft") ||
            (version.state === "signed" && (prior.state !== "draft" ||
              canonicalNursingJson(version.content) !== canonicalNursingJson(prior.content)))));
      }))) throw new Error("NURSING_SNAPSHOT_INVALID");
  return snapshot;
}
