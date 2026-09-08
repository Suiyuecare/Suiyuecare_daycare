import { z } from "zod";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { IntegrationError } from "@/lib/integrations/errors";
import { BODY_AREAS, BODY_OBSERVATION_STATES, BODY_RECORD_STATES, type BodyObservation } from "./types";

export const BODY_MUTATION_MAX_BYTES = 64 * 1024;
export const bodyUuid = z.uuid().transform((v) => v.toLowerCase());
export const bodyHash = z.string().regex(/^[a-f0-9]{64}$/u);
export const bodyText = (max: number, min = 1) => z.string().trim().min(min).max(max)
  .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v));
export const bodyTimestamp = z.string().refine((v) => isStrictOffsetDateTime(v) && Number.isFinite(Date.parse(v)))
  .transform((v) => new Date(v).toISOString());
export const bodyObservationSchema = z.object({ area: z.enum(BODY_AREAS), state: z.enum(BODY_OBSERVATION_STATES),
  description: bodyText(2000).nullable(), reason: bodyText(1000).nullable(), disposition: bodyText(2000).nullable(),
}).strict().refine((v) => {
  if (v.state === "missing" || v.state === "not_applicable") return v.reason !== null && v.description === null && v.disposition === null;
  return v.reason === null && (v.state === "abnormal" || v.disposition === null) && (v.area !== "other" || v.description !== null);
});
export const bodyObservationsSchema = z.array(bodyObservationSchema).min(1).max(BODY_AREAS.length)
  .refine((v) => new Set(v.map((o) => o.area)).size === v.length);
export function bodyObservationsReady(observations: readonly BodyObservation[]) {
  return observations.every((o) => o.state !== "abnormal" || (o.description !== null && o.disposition !== null));
}
const baseline = { client_id: bodyUuid, assessment_key: bodyUuid.nullable(), previous_version_id: bodyUuid.nullable(),
  expected_version: z.number().int().min(0).max(1_000_000), expected_content_hash: bodyHash.nullable() };
const fields = { observed_at: bodyTimestamp, observations: bodyObservationsSchema,
  instrument: z.literal("manual_nonstandard_body_observation_v1") };
const create = z.object({ action: z.literal("create"), ...baseline, ...fields, reason: bodyText(1000) }).strict();
const revise = create.extend({ action: z.literal("revise") });
const sign = z.object({ action: z.literal("sign"), ...baseline, reason: z.literal("本人確認已核對所選部位的人工觀察與處置") }).strict();
const correct = create.extend({ action: z.literal("correct"), reason: bodyText(1000, 8) });
export const bodyMutationSchema = z.discriminatedUnion("action", [create, revise, sign, correct]).refine((v) =>
  v.action === "create" ? v.assessment_key === null && v.previous_version_id === null && v.expected_version === 0 && v.expected_content_hash === null :
    v.assessment_key !== null && v.previous_version_id !== null && v.expected_version > 0 && v.expected_content_hash !== null)
  .refine((v) => v.action !== "correct" || bodyObservationsReady(v.observations));
export type BodyAssessmentMutation = z.infer<typeof bodyMutationSchema>;
export type BodyAssessmentInput = { payload: BodyAssessmentMutation; idempotencyKey: string };
export function parseBodyAssessmentMutation(value: unknown, idempotencyKey: string | null): BodyAssessmentInput {
  const key = bodyUuid.safeParse(idempotencyKey); const parsed = bodyMutationSchema.safeParse(value);
  if (!key.success || !parsed.success) throw new IntegrationError("INVALID_BODY_ASSESSMENT_OPERATION",
    "請選擇評估部位及狀態；缺值或不適用須填理由，更正簽署前須補齊異常描述與人工處置。", 400);
  return { payload: parsed.data, idempotencyKey: key.data };
}
export function stableBodyJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableBodyJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableBodyJson(val)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const bodyReceiptSchema = z.object({ operation_id: bodyUuid, organization_id: bodyUuid, branch_id: bodyUuid,
  actor_user_id: bodyUuid, client_id: bodyUuid, idempotency_key: bodyUuid, request_payload: bodyMutationSchema,
  assessment_key: bodyUuid, version_id: bodyUuid, version: z.number().int().positive().max(1_000_001),
  record_state: z.enum(BODY_RECORD_STATES), content_hash: bodyHash, committed_at: bodyTimestamp, replayed: z.boolean() }).strict();
export type BodyAssessmentReceipt = z.infer<typeof bodyReceiptSchema>;
export function parseBodyAssessmentReceipt(value: unknown, input: BodyAssessmentInput,
  scope: { organizationId: string; branchId: string; userId: string }): BodyAssessmentReceipt {
  const parsed = bodyReceiptSchema.safeParse(value); const request = input.payload;
  if (!parsed.success) throw new IntegrationError("BODY_ASSESSMENT_RECEIPT_INVALID", "身體評估回執不完整，請保留相同操作鍵重試。", 502);
  const r = parsed.data; const state = request.action === "sign" ? "signed" : request.action === "correct" ? "corrected" : "draft";
  if (r.organization_id !== scope.organizationId || r.branch_id !== scope.branchId || r.actor_user_id !== scope.userId ||
    r.client_id !== request.client_id || r.idempotency_key !== input.idempotencyKey ||
    stableBodyJson(r.request_payload) !== stableBodyJson(request) || r.version !== request.expected_version + 1 ||
    r.record_state !== state || (request.assessment_key !== null && r.assessment_key !== request.assessment_key) ||
    r.version_id === request.previous_version_id) throw new IntegrationError("BODY_ASSESSMENT_RECEIPT_INVALID",
    "身體評估回執與送出內容不一致，請保留相同操作鍵重試。", 502);
  return r;
}
export function parseBodyAssessmentSuccess(value: unknown, input: BodyAssessmentInput,
  scope: { organizationId: string; branchId: string; userId: string }, httpStatus: number) {
  const parsed = z.object({ requestId: bodyUuid, status: z.literal("ok"), data: z.unknown(), errors: z.tuple([]) }).strict().safeParse(value);
  if (!parsed.success) throw new IntegrationError("BODY_ASSESSMENT_RECEIPT_INVALID", "身體評估完成憑證不完整，請保留相同操作鍵重試。", 502);
  const result = parseBodyAssessmentReceipt(parsed.data.data, input, scope);
  if (httpStatus !== (result.replayed ? 200 : 201)) throw new IntegrationError("BODY_ASSESSMENT_RECEIPT_INVALID", "身體評估完成狀態不一致，請保留相同操作鍵重試。", 502);
  return result;
}
