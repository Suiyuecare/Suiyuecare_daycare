import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  ABCD_ASSESSMENT_STATES,
  ABCD_ASSESSMENT_TYPES,
  ABCD_VALUE_STATES,
  type AbcdAssessmentFields,
  type AbcdAssessmentMutationInput,
  type AbcdAssessmentReceipt,
} from "./types";

export const ABCD_ASSESSMENT_MUTATION_MAX_BYTES = 48 * 1024;
const uuid = z.uuid().transform((value) => value.toLowerCase());
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const instant = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(instant.getTime()) && new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant) === value;
});
const timestamp = z.string().refine((value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());
const text = (maximum: number, minimum = 1) => z.string().trim().min(minimum).max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const assessmentYear = z.number().int().min(2000).max(2200);
const result = z.object({ state: z.enum(ABCD_VALUE_STATES), text: text(4_000).nullable(),
  reason: text(1_000).nullable() }).strict().refine((value) => value.state === "recorded" ?
  value.text !== null && value.reason === null : value.text === null && value.reason !== null);
const reassessment = z.object({ state: z.enum(ABCD_VALUE_STATES), date: date.nullable(),
  basis: text(1_000) }).strict().refine((value) => value.state === "recorded" ?
  value.date !== null : value.date === null);
const fields = { client_id: uuid, assessment_type: z.enum(ABCD_ASSESSMENT_TYPES),
  assessment_year: assessmentYear, assessment_date: date, manual_summary: text(8_000),
  result, reassessment };
const save = z.object({ action: z.literal("save_assessment"), mode: z.enum(["create", "revise"]),
  assessment_key: uuid.nullable(), previous_version_id: uuid.nullable(),
  expected_version: z.number().int().min(0).max(1_000_000), expected_content_hash: sha256.nullable(),
  revision_reason: text(1_000), ...fields }).strict();
const sign = z.object({ action: z.literal("sign_assessment"), client_id: uuid, assessment_key: uuid,
  assessment_type: z.enum(ABCD_ASSESSMENT_TYPES), assessment_year: assessmentYear,
  previous_version_id: uuid, expected_version: z.number().int().positive().max(1_000_000),
  expected_content_hash: sha256 }).strict();
const correct = z.object({ action: z.literal("correct_assessment"), assessment_key: uuid,
  previous_version_id: uuid, expected_version: z.number().int().positive().max(1_000_000),
  expected_content_hash: sha256, reason: text(1_000, 8), ...fields }).strict();
const recordPayload = z.object({ ...fields, form_kind: z.literal("manual_unstandardized"),
  formal_rule_status: z.literal("not_configured") }).strict();
const receipt = z.object({ organization_id: uuid, branch_id: uuid, client_id: uuid,
  operation_id: uuid, idempotency_key: uuid,
  action: z.enum(["save_assessment", "sign_assessment", "correct_assessment"]),
  assessment_key: uuid, version_id: uuid, version: z.number().int().positive().max(1_000_000),
  assessment_state: z.enum(ABCD_ASSESSMENT_STATES), assessment_type: z.enum(ABCD_ASSESSMENT_TYPES),
  assessment_year: assessmentYear, previous_version_id: uuid.nullable(),
  source_content_hash: sha256.nullable(), content_hash: sha256,
  record_payload: recordPayload, committed_at: timestamp,
  replayed: z.boolean() }).strict();

function invalid(message: string): never {
  throw new IntegrationError("INVALID_ABCD_ASSESSMENT_OPERATION", message, 400);
}

type ParsedFields = { client_id: string; assessment_type: (typeof ABCD_ASSESSMENT_TYPES)[number];
  assessment_year: number; assessment_date: string; manual_summary: string;
  result: z.output<typeof result>; reassessment: z.output<typeof reassessment> };

function mappedFields(value: ParsedFields): AbcdAssessmentFields {
  if (Number(value.assessment_date.slice(0, 4)) !== value.assessment_year ||
    (value.reassessment.date !== null && value.reassessment.date < value.assessment_date)) {
    invalid("評估日期、年度或人工複評日期不一致。");
  }
  return { clientId: value.client_id, assessmentType: value.assessment_type,
    assessmentYear: value.assessment_year, assessmentDate: value.assessment_date,
    manualSummary: value.manual_summary, result: value.result, reassessment: value.reassessment };
}

export function parseAbcdAssessmentMutation(value: unknown, idempotencyHeader: string | null): AbcdAssessmentMutationInput {
  const key = uuid.safeParse(idempotencyHeader);
  if (!key.success) invalid("ABCD 評估冪等鍵無效。");
  const action = z.object({ action: z.string() }).passthrough().safeParse(value);
  if (!action.success) invalid("ABCD 評估操作內容無效。");
  if (action.data.action === "save_assessment") {
    const parsed = save.safeParse(value);
    if (!parsed.success) invalid("人工摘要、結果三態、複評三態或版本基準無效。");
    const row = parsed.data;
    if ((row.mode === "create" && (row.assessment_key !== null || row.previous_version_id !== null ||
      row.expected_version !== 0 || row.expected_content_hash !== null)) ||
      (row.mode === "revise" && (row.assessment_key === null || row.previous_version_id === null ||
        row.expected_version < 1 || row.expected_content_hash === null))) invalid("評估版本基準不一致。");
    return { ...mappedFields(row), action: row.action, mode: row.mode,
      assessmentKey: row.assessment_key, previousVersionId: row.previous_version_id,
      expectedVersion: row.expected_version, expectedContentHash: row.expected_content_hash,
      revisionReason: row.revision_reason, idempotencyKey: key.data };
  }
  if (action.data.action === "sign_assessment") {
    const parsed = sign.safeParse(value);
    if (!parsed.success) invalid("簽署版本或 A／B／C／D 年度身分無效。");
    return { action: parsed.data.action, clientId: parsed.data.client_id,
      assessmentKey: parsed.data.assessment_key, assessmentType: parsed.data.assessment_type,
      assessmentYear: parsed.data.assessment_year, previousVersionId: parsed.data.previous_version_id,
      expectedVersion: parsed.data.expected_version, expectedContentHash: parsed.data.expected_content_hash,
      idempotencyKey: key.data };
  }
  if (action.data.action === "correct_assessment") {
    const parsed = correct.safeParse(value);
    if (!parsed.success) invalid("更正版內容、理由或版本基準無效。");
    return { ...mappedFields(parsed.data), action: parsed.data.action,
      assessmentKey: parsed.data.assessment_key, previousVersionId: parsed.data.previous_version_id,
      expectedVersion: parsed.data.expected_version, expectedContentHash: parsed.data.expected_content_hash,
      reason: parsed.data.reason, idempotencyKey: key.data };
  }
  invalid("不支援的 ABCD 評估操作。");
}

export function abcdAssessmentPayload(input: AbcdAssessmentMutationInput) {
  const base = { client_id: input.clientId, assessment_key: input.assessmentKey,
    previous_version_id: input.previousVersionId, expected_version: input.expectedVersion,
    expected_content_hash: input.expectedContentHash, assessment_type: input.assessmentType,
    assessment_year: input.assessmentYear };
  if (input.action === "sign_assessment") return base;
  return { ...base, assessment_date: input.assessmentDate, manual_summary: input.manualSummary,
    result: input.result, reassessment: input.reassessment,
    reason: input.action === "correct_assessment" ? input.reason : input.revisionReason,
    ...(input.action === "save_assessment" ? { mode: input.mode } : {}) };
}

export function parseAbcdAssessmentReceipt(value: unknown, input: AbcdAssessmentMutationInput,
  expectedOrganizationId: string, expectedBranchId: string): AbcdAssessmentReceipt {
  const parsed = receipt.safeParse(value);
  const context = z.object({ organizationId: uuid, branchId: uuid }).strict().safeParse({
    organizationId: expectedOrganizationId, branchId: expectedBranchId });
  if (!parsed.success || !context.success) throw new IntegrationError("ABCD_ASSESSMENT_RECEIPT_INVALID",
    "ABCD 評估回執不完整；請保留相同操作鍵重新核對。", 502);
  const row = parsed.data;
  let persistedFields: AbcdAssessmentFields;
  try { persistedFields = mappedFields(row.record_payload); }
  catch { throw new IntegrationError("ABCD_ASSESSMENT_RECEIPT_INVALID",
    "ABCD 評估回執中的保存內容無效；請保留相同操作鍵重新核對。", 502); }
  const expectedState = input.action === "save_assessment" ? "draft" :
    input.action === "sign_assessment" ? "signed" : "corrected";
  const expectedPreviousVersionId = input.previousVersionId;
  const expectedSourceContentHash = input.expectedContentHash;
  const contentMatches = input.action === "sign_assessment" || (
    persistedFields.assessmentDate === input.assessmentDate &&
    persistedFields.manualSummary === input.manualSummary &&
    persistedFields.result.state === input.result.state &&
    persistedFields.result.text === input.result.text &&
    persistedFields.result.reason === input.result.reason &&
    persistedFields.reassessment.state === input.reassessment.state &&
    persistedFields.reassessment.date === input.reassessment.date &&
    persistedFields.reassessment.basis === input.reassessment.basis);
  if (row.organization_id !== context.data.organizationId || row.branch_id !== context.data.branchId ||
    row.client_id !== input.clientId || row.idempotency_key !== input.idempotencyKey ||
    row.action !== input.action || row.assessment_state !== expectedState ||
    row.version !== input.expectedVersion + 1 || row.assessment_type !== input.assessmentType ||
    row.assessment_year !== input.assessmentYear ||
    row.previous_version_id !== expectedPreviousVersionId ||
    row.source_content_hash !== expectedSourceContentHash ||
    persistedFields.clientId !== input.clientId ||
    persistedFields.assessmentType !== input.assessmentType ||
    persistedFields.assessmentYear !== input.assessmentYear || !contentMatches ||
    (input.assessmentKey !== null && row.assessment_key !== input.assessmentKey)) {
    throw new IntegrationError("ABCD_ASSESSMENT_RECEIPT_INVALID",
      "ABCD 評估回執與送出內容不一致；請重新載入。", 502);
  }
  return { organizationId: row.organization_id, branchId: row.branch_id, clientId: row.client_id,
    operationId: row.operation_id, idempotencyKey: row.idempotency_key,
    action: row.action, assessmentKey: row.assessment_key,
    versionId: row.version_id, version: row.version, assessmentState: row.assessment_state,
    assessmentType: row.assessment_type, assessmentYear: row.assessment_year,
    previousVersionId: row.previous_version_id, sourceContentHash: row.source_content_hash,
    contentHash: row.content_hash, recordPayload: { ...persistedFields,
      formKind: row.record_payload.form_kind, formalRuleStatus: row.record_payload.formal_rule_status },
    committedAt: row.committed_at, replayed: row.replayed,
    persisted: true, demo: false };
}
