import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";

import {
  CASE_SERVICE_EXECUTION_STATUSES,
  CASE_SERVICE_RECORD_STATES,
  type CaseServiceRecordFields,
  type CaseServiceRecordMutationInput,
  type CaseServiceRecordReceipt,
  type CaseServiceRecordReceiptPayload,
} from "./types";

export const CASE_SERVICE_RECORD_MUTATION_MAX_BYTES = 64 * 1024;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().refine(isStrictOffsetDateTime)
  .transform((value) => new Date(value).toISOString());
const text = (maximum: number, minimum = 1) => z.string().trim().min(minimum).max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));

const fields = {
  client_id: uuid,
  started_at: timestamp,
  ended_at: timestamp,
  service_type: text(120),
  service_content: text(8_000),
  service_result: text(4_000),
  execution_reference_id: uuid.nullable(),
};
const save = z.object({
  action: z.literal("save_record"),
  mode: z.enum(["create", "revise"]),
  record_key: uuid.nullable(),
  previous_version_id: uuid.nullable(),
  expected_version: z.number().int().min(0).max(1_000_000),
  expected_content_hash: sha256.nullable(),
  revision_reason: text(1_000),
  ...fields,
}).strict();
const correct = z.object({
  action: z.literal("correct_record"),
  record_key: uuid,
  previous_version_id: uuid,
  expected_version: z.number().int().positive().max(1_000_000),
  expected_content_hash: sha256,
  expected_author_user_id: uuid,
  reason: text(1_000, 8),
  ...fields,
}).strict();
const recordPayload = z.object({
  ...fields,
  execution_reference_status: z.enum(CASE_SERVICE_EXECUTION_STATUSES),
  execution_reference_content_hash: sha256.nullable(),
  author_user_id: uuid,
  source_kind: z.literal("manual_local"),
  schema_kind: z.literal("manual_service_narrative_v1"),
  statutory_rule_status: z.literal("not_configured"),
  claim_eligibility_status: z.literal("not_configured"),
}).strict();
const sign = z.object({
  action: z.literal("sign_record"),
  client_id: uuid,
  record_key: uuid,
  previous_version_id: uuid,
  expected_version: z.number().int().positive().max(1_000_000),
  expected_content_hash: sha256,
  expected_record_payload: recordPayload,
}).strict();
const receipt = z.object({
  organization_id: uuid,
  branch_id: uuid,
  client_id: uuid,
  actor_user_id: uuid,
  operation_id: uuid,
  idempotency_key: uuid,
  action: z.enum(["save_record", "sign_record", "correct_record"]),
  record_key: uuid,
  version_id: uuid,
  version: z.number().int().positive().max(1_000_000),
  record_state: z.enum(CASE_SERVICE_RECORD_STATES),
  previous_version_id: uuid.nullable(),
  source_content_hash: sha256.nullable(),
  content_hash: sha256,
  record_payload: recordPayload,
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError("INVALID_CASE_SERVICE_RECORD_OPERATION", message, 400, field);
}

type ParsedFields = {
  client_id: string;
  started_at: string;
  ended_at: string;
  service_type: string;
  service_content: string;
  service_result: string;
  execution_reference_id: string | null;
};

function mappedFields(value: ParsedFields): CaseServiceRecordFields {
  if (Date.parse(value.ended_at) < Date.parse(value.started_at)) {
    invalid("服務結束時間不可早於開始時間。", "ended_at");
  }
  return {
    clientId: value.client_id,
    startedAt: value.started_at,
    endedAt: value.ended_at,
    serviceType: value.service_type,
    serviceContent: value.service_content,
    serviceResult: value.service_result,
    executionReferenceId: value.execution_reference_id,
  };
}

export function parseCaseServiceRecordMutation(
  value: unknown,
  idempotencyHeader: string | null,
): CaseServiceRecordMutationInput {
  const key = uuid.safeParse(idempotencyHeader);
  if (!key.success) invalid("個案服務紀錄冪等鍵無效。", "idempotency-key");
  const action = z.object({ action: z.string() }).passthrough().safeParse(value);
  if (!action.success) invalid("個案服務紀錄操作內容無效。");
  if (action.data.action === "save_record") {
    const parsed = save.safeParse(value);
    if (!parsed.success) invalid("個案、服務期間、人工服務內容、人工結果或版本基準無效。");
    const row = parsed.data;
    if ((row.mode === "create" && (row.record_key !== null || row.previous_version_id !== null ||
      row.expected_version !== 0 || row.expected_content_hash !== null)) ||
      (row.mode === "revise" && (row.record_key === null || row.previous_version_id === null ||
        row.expected_version < 1 || row.expected_content_hash === null))) {
      invalid("個案服務紀錄版本基準不一致。");
    }
    return {
      ...mappedFields(row),
      action: row.action,
      mode: row.mode,
      recordKey: row.record_key,
      previousVersionId: row.previous_version_id,
      expectedVersion: row.expected_version,
      expectedContentHash: row.expected_content_hash,
      revisionReason: row.revision_reason,
      idempotencyKey: key.data,
    };
  }
  if (action.data.action === "sign_record") {
    const parsed = sign.safeParse(value);
    if (!parsed.success) invalid("簽署的個案、版本或內容指紋無效。");
    return {
      action: parsed.data.action,
      clientId: parsed.data.client_id,
      recordKey: parsed.data.record_key,
      previousVersionId: parsed.data.previous_version_id,
      expectedVersion: parsed.data.expected_version,
      expectedContentHash: parsed.data.expected_content_hash,
      expectedRecordPayload: mapReceiptPayload(parsed.data.expected_record_payload),
      idempotencyKey: key.data,
    };
  }
  if (action.data.action === "correct_record") {
    const parsed = correct.safeParse(value);
    if (!parsed.success) invalid("更正版人工內容、理由或版本基準無效。");
    return {
      ...mappedFields(parsed.data),
      action: parsed.data.action,
      recordKey: parsed.data.record_key,
      previousVersionId: parsed.data.previous_version_id,
      expectedVersion: parsed.data.expected_version,
      expectedContentHash: parsed.data.expected_content_hash,
      expectedAuthorUserId: parsed.data.expected_author_user_id,
      reason: parsed.data.reason,
      idempotencyKey: key.data,
    };
  }
  invalid("不支援的個案服務紀錄操作。", "action");
}

export function caseServiceRecordPayload(input: CaseServiceRecordMutationInput) {
  const base = {
    client_id: input.clientId,
    record_key: input.recordKey,
    previous_version_id: input.previousVersionId,
    expected_version: input.expectedVersion,
    expected_content_hash: input.expectedContentHash,
  };
  if (input.action === "sign_record") return {
    ...base,
    expected_record_payload: {
      client_id: input.expectedRecordPayload.clientId,
      started_at: input.expectedRecordPayload.startedAt,
      ended_at: input.expectedRecordPayload.endedAt,
      service_type: input.expectedRecordPayload.serviceType,
      service_content: input.expectedRecordPayload.serviceContent,
      service_result: input.expectedRecordPayload.serviceResult,
      execution_reference_id: input.expectedRecordPayload.executionReferenceId,
      execution_reference_status: input.expectedRecordPayload.executionReferenceStatus,
      execution_reference_content_hash: input.expectedRecordPayload.executionReferenceContentHash,
      author_user_id: input.expectedRecordPayload.authorUserId,
      source_kind: input.expectedRecordPayload.sourceKind,
      schema_kind: input.expectedRecordPayload.schemaKind,
      statutory_rule_status: input.expectedRecordPayload.statutoryRuleStatus,
      claim_eligibility_status: input.expectedRecordPayload.claimEligibilityStatus,
    },
  };
  return {
    ...base,
    started_at: input.startedAt,
    ended_at: input.endedAt,
    service_type: input.serviceType,
    service_content: input.serviceContent,
    service_result: input.serviceResult,
    execution_reference_id: input.executionReferenceId,
    reason: input.action === "correct_record" ? input.reason : input.revisionReason,
    ...(input.action === "correct_record" ? {
      expected_author_user_id: input.expectedAuthorUserId,
    } : {}),
    ...(input.action === "save_record" ? { mode: input.mode } : {}),
  };
}

function mapReceiptPayload(value: z.output<typeof recordPayload>): CaseServiceRecordReceiptPayload {
  let mapped: CaseServiceRecordFields;
  try {
    mapped = mappedFields(value);
  } catch {
    throw new IntegrationError(
      "CASE_SERVICE_RECORD_RECEIPT_INVALID",
      "個案服務紀錄回執中的保存內容無效；請保留相同操作鍵重新核對。",
      502,
    );
  }
  const linked = value.execution_reference_id !== null;
  if (linked !== (value.execution_reference_status === "linked_completed_event") ||
    linked !== (value.execution_reference_content_hash !== null)) {
    throw new IntegrationError(
      "CASE_SERVICE_RECORD_RECEIPT_INVALID",
      "個案服務紀錄回執中的執行來源證據不一致；請重新載入。",
      502,
    );
  }
  return {
    ...mapped,
    executionReferenceStatus: value.execution_reference_status,
    executionReferenceContentHash: value.execution_reference_content_hash,
    authorUserId: value.author_user_id,
    sourceKind: value.source_kind,
    schemaKind: value.schema_kind,
    statutoryRuleStatus: value.statutory_rule_status,
    claimEligibilityStatus: value.claim_eligibility_status,
  };
}

export function parseCaseServiceRecordReceipt(
  value: unknown,
  input: CaseServiceRecordMutationInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
  expectedActorUserId: string,
): CaseServiceRecordReceipt {
  const parsed = receipt.safeParse(value);
  const context = z.object({ organizationId: uuid, branchId: uuid, actorUserId: uuid }).strict().safeParse({
    organizationId: expectedOrganizationId,
    branchId: expectedBranchId,
    actorUserId: expectedActorUserId,
  });
  if (!parsed.success || !context.success) {
    throw new IntegrationError(
      "CASE_SERVICE_RECORD_RECEIPT_INVALID",
      "個案服務紀錄回執不完整；請保留相同操作鍵重新核對。",
      502,
    );
  }
  const row = parsed.data;
  const persisted = mapReceiptPayload(row.record_payload);
  const expectedState = input.action === "save_record" ? "draft" :
    input.action === "sign_record" ? "signed" : "corrected";
  const expectedFields = input.action === "sign_record" ? input.expectedRecordPayload : input;
  const fieldsMatch = persisted.startedAt === expectedFields.startedAt &&
    persisted.endedAt === expectedFields.endedAt && persisted.serviceType === expectedFields.serviceType &&
    persisted.serviceContent === expectedFields.serviceContent &&
    persisted.serviceResult === expectedFields.serviceResult &&
    persisted.executionReferenceId === expectedFields.executionReferenceId;
  const signEvidenceMatches = input.action !== "sign_record" || (
    persisted.executionReferenceStatus === input.expectedRecordPayload.executionReferenceStatus &&
    persisted.executionReferenceContentHash === input.expectedRecordPayload.executionReferenceContentHash &&
    persisted.authorUserId === input.expectedRecordPayload.authorUserId &&
    persisted.sourceKind === input.expectedRecordPayload.sourceKind &&
    persisted.schemaKind === input.expectedRecordPayload.schemaKind &&
    persisted.statutoryRuleStatus === input.expectedRecordPayload.statutoryRuleStatus &&
    persisted.claimEligibilityStatus === input.expectedRecordPayload.claimEligibilityStatus);
  const correctionAuthorMatches = input.action !== "correct_record" ||
    persisted.authorUserId === input.expectedAuthorUserId;
  if (row.organization_id !== context.data.organizationId ||
    row.branch_id !== context.data.branchId || row.client_id !== input.clientId ||
    row.actor_user_id !== context.data.actorUserId || row.idempotency_key !== input.idempotencyKey ||
    row.action !== input.action || row.record_state !== expectedState ||
    row.version !== input.expectedVersion + 1 || row.previous_version_id !== input.previousVersionId ||
    row.source_content_hash !== input.expectedContentHash || persisted.clientId !== input.clientId ||
    !fieldsMatch || !signEvidenceMatches || !correctionAuthorMatches ||
    (input.recordKey !== null && row.record_key !== input.recordKey) ||
    (input.action === "save_record" && persisted.authorUserId !== context.data.actorUserId)) {
    throw new IntegrationError(
      "CASE_SERVICE_RECORD_RECEIPT_INVALID",
      "個案服務紀錄回執與送出內容不一致；請重新載入。",
      502,
    );
  }
  return {
    organizationId: row.organization_id,
    branchId: row.branch_id,
    clientId: row.client_id,
    actorUserId: row.actor_user_id,
    operationId: row.operation_id,
    idempotencyKey: row.idempotency_key,
    action: row.action,
    recordKey: row.record_key,
    versionId: row.version_id,
    version: row.version,
    recordState: row.record_state,
    previousVersionId: row.previous_version_id,
    sourceContentHash: row.source_content_hash,
    contentHash: row.content_hash,
    recordPayload: persisted,
    committedAt: row.committed_at,
    replayed: row.replayed,
    persisted: true,
    demo: false,
  };
}
