import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import { parseCaseServiceRecordReceipt } from "./parser";
import {
  CASE_SERVICE_EXECUTION_STATUSES,
  CASE_SERVICE_RECORD_STATES,
  type CaseServiceRecordMutationInput,
  type CaseServiceRecordReceipt,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const recordPayload = z.object({
  clientId: uuid,
  startedAt: z.string(),
  endedAt: z.string(),
  serviceType: z.string(),
  serviceContent: z.string(),
  serviceResult: z.string(),
  executionReferenceId: uuid.nullable(),
  executionReferenceStatus: z.enum(CASE_SERVICE_EXECUTION_STATUSES),
  executionReferenceContentHash: hash.nullable(),
  authorUserId: uuid,
  sourceKind: z.literal("manual_local"),
  schemaKind: z.literal("manual_service_narrative_v1"),
  statutoryRuleStatus: z.literal("not_configured"),
  claimEligibilityStatus: z.literal("not_configured"),
}).strict();
const data = z.object({
  organizationId: uuid,
  branchId: uuid,
  clientId: uuid,
  actorUserId: uuid,
  operationId: uuid,
  idempotencyKey: uuid,
  action: z.enum(["save_record", "sign_record", "correct_record"]),
  recordKey: uuid,
  versionId: uuid,
  version: z.number().int().positive().max(1_000_000),
  recordState: z.enum(CASE_SERVICE_RECORD_STATES),
  previousVersionId: uuid.nullable(),
  sourceContentHash: hash.nullable(),
  contentHash: hash,
  recordPayload,
  committedAt: z.string(),
  replayed: z.boolean(),
  persisted: z.literal(true),
  demo: z.literal(false),
}).strict();
const envelope = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data,
  errors: z.tuple([]),
}).strict();

function invalid(): never {
  throw new IntegrationError(
    "CASE_SERVICE_RECORD_RECEIPT_INVALID",
    "個案服務紀錄回應無法確認；請保留相同操作鍵重新核對。",
    502,
  );
}

/** Strictly translates the browser-facing camelCase success envelope back to the SQL receipt contract. */
export function parseCaseServiceRecordApiEnvelope(
  payload: unknown,
  httpStatus: number,
  input: CaseServiceRecordMutationInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
  expectedActorUserId: string,
): CaseServiceRecordReceipt {
  const parsed = envelope.safeParse(payload);
  if (!parsed.success) invalid();
  const value = parsed.data.data;
  if (httpStatus !== (value.replayed ? 200 : 201)) invalid();
  return parseCaseServiceRecordReceipt({
    organization_id: value.organizationId,
    branch_id: value.branchId,
    client_id: value.clientId,
    actor_user_id: value.actorUserId,
    operation_id: value.operationId,
    idempotency_key: value.idempotencyKey,
    action: value.action,
    record_key: value.recordKey,
    version_id: value.versionId,
    version: value.version,
    record_state: value.recordState,
    previous_version_id: value.previousVersionId,
    source_content_hash: value.sourceContentHash,
    content_hash: value.contentHash,
    record_payload: {
      client_id: value.recordPayload.clientId,
      started_at: value.recordPayload.startedAt,
      ended_at: value.recordPayload.endedAt,
      service_type: value.recordPayload.serviceType,
      service_content: value.recordPayload.serviceContent,
      service_result: value.recordPayload.serviceResult,
      execution_reference_id: value.recordPayload.executionReferenceId,
      execution_reference_status: value.recordPayload.executionReferenceStatus,
      execution_reference_content_hash: value.recordPayload.executionReferenceContentHash,
      author_user_id: value.recordPayload.authorUserId,
      source_kind: value.recordPayload.sourceKind,
      schema_kind: value.recordPayload.schemaKind,
      statutory_rule_status: value.recordPayload.statutoryRuleStatus,
      claim_eligibility_status: value.recordPayload.claimEligibilityStatus,
    },
    committed_at: value.committedAt,
    replayed: value.replayed,
  }, input, expectedOrganizationId, expectedBranchId, expectedActorUserId);
}
