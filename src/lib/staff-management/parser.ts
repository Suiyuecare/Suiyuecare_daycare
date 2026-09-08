import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import { isStaffManagementDate, staffManagementTaipeiDate } from "./date";
import type {
  StaffEmploymentProposalInput,
  StaffProposalDecisionInput,
  StaffProposalDecisionReceipt,
  StaffProposalReceipt,
  StaffRoleApprovalInput,
  StaffRoleApprovalReceipt,
  StaffRoleChangeInput,
  StaffRoleRequestReceipt,
  StaffTerminationProposalInput,
} from "./types";

export const STAFF_MANAGEMENT_PROPOSAL_MAX_BYTES = 24 * 1024;
export const STAFF_MANAGEMENT_DECISION_MAX_BYTES = 8 * 1024;
export const STAFF_MANAGEMENT_ROLE_MAX_BYTES = 8 * 1024;
export const STAFF_MANAGEMENT_ACTION_HEADER = "x-staff-management-action";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().refine(isStaffManagementDate);
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const safePositive = z.number().int().positive().safe();
const safeNonnegative = z.number().int().nonnegative().safe();

const employmentProposalSchema = z.discriminatedUnion("proposal_action", [
  z.object({
    action: z.literal("propose"), proposal_action: z.literal("onboard"),
    proposal_key: uuid, target_membership_id: uuid, target_profile_id: uuid,
    expected_membership_version: z.literal(0), target_membership_status: z.literal("active"),
    starts_on: date, ends_on: date.nullable(), employment_type_text: clean(120),
    job_title_text: clean(160), registration_status_text: clean(160),
    change_reason: clean(1_000, true),
  }).strict(),
  z.object({
    action: z.literal("propose"), proposal_action: z.literal("employment_change"),
    proposal_key: uuid, target_membership_id: uuid, target_profile_id: uuid,
    expected_membership_version: safePositive,
    target_membership_status: z.enum(["active", "suspended"]),
    starts_on: date, ends_on: date.nullable(), employment_type_text: clean(120),
    job_title_text: clean(160), registration_status_text: clean(160),
    change_reason: clean(1_000, true),
  }).strict(),
]);

const terminationSchema = z.object({
  action: z.literal("terminate"), proposal_key: uuid,
  target_membership_id: uuid, target_profile_id: uuid,
  expected_membership_version: safePositive, starts_on: date,
  termination_effective_on: date, change_reason: clean(1_000, true),
}).strict();

const decisionSchema = z.object({
  action: z.literal("decide"),
  proposal_action: z.enum(["onboard", "employment_change", "terminate"]),
  proposal_id: uuid, expected_proposal_number: safePositive,
  expected_membership_version: safeNonnegative, expected_content_hash: hash,
  expected_target_membership_id: uuid, expected_target_profile_id: uuid,
  decision: z.enum(["approve", "reject"]), decision_reason: clean(1_000, true),
}).strict();

const roleRequestSchema = z.object({
  action: z.literal("request_role"), operation: z.enum(["assign_role", "revoke_role"]),
  target_membership_id: uuid, target_role_id: uuid,
  expected_membership_version: safePositive,
}).strict();

const roleApprovalSchema = z.object({
  action: z.literal("approve_role"), request_id: uuid,
  expected_membership_version: safePositive,
  expected_operation: z.enum(["assign_role", "revoke_role"]),
  expected_target_membership_id: uuid, expected_target_role_id: uuid,
}).strict();

const proposalReceiptSchema = z.object({
  organization_id: uuid, branch_id: uuid, proposal_id: uuid, proposal_key: uuid,
  proposal_number: safePositive, action: z.enum(["onboard", "employment_change", "terminate"]),
  proposal_status: z.literal("pending"), target_membership_id: uuid,
  target_profile_id: uuid, expected_membership_version: safeNonnegative,
  content_hash: hash, requested_at: timestamp, replayed: z.boolean(),
}).strict();

const decisionReceiptSchema = z.object({
  organization_id: uuid, branch_id: uuid, proposal_id: uuid,
  proposal_number: safePositive, action: z.enum(["onboard", "employment_change", "terminate"]),
  decision: z.enum(["approve", "reject"]),
  proposal_status: z.enum(["approved", "rejected"]),
  target_membership_id: uuid, target_profile_id: uuid,
  result_employment_version_id: uuid.nullable(),
  result_employment_version: safePositive.nullable(),
  result_membership_version: safePositive.nullable(),
  result_revocation_job_id: uuid.nullable(),
  revocation_provider_status: z.literal("not_configured").nullable(),
  revocation_verification_status: z.literal("not_verified").nullable(),
  revocation_queued_at: timestamp.nullable(),
  revocation_deadline_at: timestamp.nullable(),
  content_hash: hash, decided_at: timestamp, replayed: z.boolean(),
}).strict();

const roleRequestReceiptSchema = z.object({
  organization_id: uuid, branch_id: uuid, request_id: uuid,
  operation: z.enum(["assign_role", "revoke_role"]),
  target_membership_id: uuid, target_role_id: uuid,
  expected_membership_version: safePositive, request_status: z.literal("pending"),
  request_hash: hash, requested_at: timestamp, replayed: z.boolean(),
}).strict();

const roleApprovalReceiptSchema = z.object({
  organization_id: uuid, branch_id: uuid, request_id: uuid,
  operation: z.enum(["assign_role", "revoke_role"]),
  target_membership_id: uuid, target_role_id: uuid,
  expected_membership_version: safePositive,
  result_membership_version: safePositive, request_status: z.literal("approved"),
  applied_at: timestamp, replayed: z.boolean(),
}).strict();

const apiProposalReceiptSchema = z.object({
  organizationId: uuid, branchId: uuid, proposalId: uuid, proposalKey: uuid,
  proposalNumber: safePositive,
  proposalAction: z.enum(["onboard", "employment_change", "terminate"]),
  proposalStatus: z.literal("pending"), targetMembershipId: uuid,
  targetProfileId: uuid, expectedMembershipVersion: safeNonnegative,
  contentHash: hash, requestedAt: timestamp, replayed: z.boolean(),
  persisted: z.literal(true), demo: z.literal(false),
}).strict();

const apiDecisionReceiptSchema = z.object({
  organizationId: uuid, branchId: uuid, proposalId: uuid,
  proposalNumber: safePositive,
  proposalAction: z.enum(["onboard", "employment_change", "terminate"]),
  decision: z.enum(["approve", "reject"]),
  proposalStatus: z.enum(["approved", "rejected"]),
  targetMembershipId: uuid, targetProfileId: uuid,
  resultEmploymentVersionId: uuid.nullable(),
  resultEmploymentVersion: safePositive.nullable(),
  resultMembershipVersion: safePositive.nullable(),
  resultRevocationJobId: uuid.nullable(),
  revocationProviderStatus: z.literal("not_configured").nullable(),
  revocationVerificationStatus: z.literal("not_verified").nullable(),
  revocationQueuedAt: timestamp.nullable(), revocationDeadlineAt: timestamp.nullable(),
  contentHash: hash, decidedAt: timestamp, replayed: z.boolean(),
  persisted: z.literal(true), demo: z.literal(false),
}).strict();

const apiRoleRequestReceiptSchema = z.object({
  organizationId: uuid, branchId: uuid, requestId: uuid,
  operation: z.enum(["assign_role", "revoke_role"]),
  targetMembershipId: uuid, targetRoleId: uuid,
  expectedMembershipVersion: safePositive, requestStatus: z.literal("pending"),
  requestHash: hash, requestedAt: timestamp, replayed: z.boolean(),
  persisted: z.literal(true), demo: z.literal(false),
}).strict();

const apiRoleApprovalReceiptSchema = z.object({
  organizationId: uuid, branchId: uuid, requestId: uuid,
  operation: z.enum(["assign_role", "revoke_role"]),
  targetMembershipId: uuid, targetRoleId: uuid,
  expectedMembershipVersion: safePositive, resultMembershipVersion: safePositive,
  requestStatus: z.literal("approved"), appliedAt: timestamp, replayed: z.boolean(),
  persisted: z.literal(true), demo: z.literal(false),
}).strict();

const envelopeSchema = z.object({
  requestId: uuid, status: z.literal("ok"), data: z.unknown(),
  errors: z.array(z.never()).length(0),
}).strict();

function invalid(message: string): never {
  throw new IntegrationError("INVALID_STAFF_MANAGEMENT_INPUT", message, 400);
}

function uncertain(message: string): never {
  throw new IntegrationError("STAFF_MANAGEMENT_RECEIPT_INVALID", message, 409);
}

function parseKey(value: string | null) {
  const result = uuid.safeParse(value);
  if (!result.success) invalid("請提供有效且固定的操作鍵。");
  return result.data;
}

export function parseStaffEmploymentProposalInput(
  value: unknown, idempotencyHeader: string | null,
): StaffEmploymentProposalInput {
  const parsed = employmentProposalSchema.safeParse(value);
  if (!parsed.success) invalid("請完整填寫員工、預期版本、聘僱、職務、登錄與異動理由。");
  const body = parsed.data;
  if (body.ends_on !== null && body.ends_on < body.starts_on) {
    invalid("聘僱迄日不可早於到職日。");
  }
  return {
    action: "propose", proposalAction: body.proposal_action,
    proposalKey: body.proposal_key, targetMembershipId: body.target_membership_id,
    targetProfileId: body.target_profile_id,
    expectedMembershipVersion: body.expected_membership_version,
    targetMembershipStatus: body.target_membership_status,
    startsOn: body.starts_on, endsOn: body.ends_on,
    employmentTypeText: body.employment_type_text,
    jobTitleText: body.job_title_text,
    registrationStatusText: body.registration_status_text,
    changeReason: body.change_reason, idempotencyKey: parseKey(idempotencyHeader),
  };
}

export function parseStaffTerminationProposalInput(
  value: unknown, idempotencyHeader: string | null, now = new Date(),
): StaffTerminationProposalInput {
  const parsed = terminationSchema.safeParse(value);
  if (!parsed.success) invalid("請提供員工、預期版本、到職日、離職日與停用理由。");
  if (parsed.data.termination_effective_on > staffManagementTaipeiDate(now)) {
    invalid("未來離職日不可立即停用帳號；請於生效日再送出。");
  }
  if (parsed.data.termination_effective_on < parsed.data.starts_on) {
    invalid("離職日不可早於到職日。");
  }
  return {
    action: "terminate", proposalKey: parsed.data.proposal_key,
    targetMembershipId: parsed.data.target_membership_id,
    targetProfileId: parsed.data.target_profile_id,
    expectedMembershipVersion: parsed.data.expected_membership_version,
    startsOn: parsed.data.starts_on,
    terminationEffectiveOn: parsed.data.termination_effective_on,
    changeReason: parsed.data.change_reason,
    idempotencyKey: parseKey(idempotencyHeader),
  };
}

export function parseStaffProposalDecisionInput(
  value: unknown, idempotencyHeader: string | null,
  allowedActions?: readonly StaffProposalDecisionInput["proposalAction"][],
): StaffProposalDecisionInput {
  const parsed = decisionSchema.safeParse(value);
  if (!parsed.success || allowedActions &&
    !allowedActions.includes(parsed.data.proposal_action)) {
    invalid("請提供待審提案、預期版本、決定、理由與操作鍵。");
  }
  return {
    action: "decide", proposalAction: parsed.data.proposal_action,
    proposalId: parsed.data.proposal_id,
    expectedProposalNumber: parsed.data.expected_proposal_number,
    expectedMembershipVersion: parsed.data.expected_membership_version,
    expectedContentHash: parsed.data.expected_content_hash,
    expectedTargetMembershipId: parsed.data.expected_target_membership_id,
    expectedTargetProfileId: parsed.data.expected_target_profile_id,
    decision: parsed.data.decision, decisionReason: parsed.data.decision_reason,
    idempotencyKey: parseKey(idempotencyHeader),
  };
}

export function parseStaffRoleChangeInput(
  value: unknown, idempotencyHeader: string | null,
): StaffRoleChangeInput {
  const parsed = roleRequestSchema.safeParse(value);
  if (!parsed.success) invalid("請提供員工、角色、操作與預期版本。");
  return {
    action: "request_role", operation: parsed.data.operation,
    targetMembershipId: parsed.data.target_membership_id,
    targetRoleId: parsed.data.target_role_id,
    expectedMembershipVersion: parsed.data.expected_membership_version,
    idempotencyKey: parseKey(idempotencyHeader),
  };
}

export function parseStaffRoleApprovalInput(
  value: unknown, idempotencyHeader: string | null,
): StaffRoleApprovalInput {
  const parsed = roleApprovalSchema.safeParse(value);
  if (!parsed.success) invalid("請提供待審角色異動與完整預期內容。");
  return {
    action: "approve_role", requestId: parsed.data.request_id,
    expectedMembershipVersion: parsed.data.expected_membership_version,
    expectedOperation: parsed.data.expected_operation,
    expectedTargetMembershipId: parsed.data.expected_target_membership_id,
    expectedTargetRoleId: parsed.data.expected_target_role_id,
    idempotencyKey: parseKey(idempotencyHeader),
  };
}

export function parseStaffProposalReceipt(
  value: unknown,
  input: StaffEmploymentProposalInput | StaffTerminationProposalInput,
  expectedOrganizationId: string, expectedBranchId: string,
): StaffProposalReceipt {
  const parsed = proposalReceiptSchema.safeParse(value);
  const action = input.action === "terminate" ? "terminate" : input.proposalAction;
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId || parsed.data.proposal_key !== input.proposalKey ||
    parsed.data.action !== action ||
    parsed.data.target_membership_id !== input.targetMembershipId ||
    parsed.data.target_profile_id !== input.targetProfileId ||
    parsed.data.expected_membership_version !== input.expectedMembershipVersion) uncertain(
    "員工異動提案結果無法與送出內容核對；請保留相同操作鍵重試。",
  );
  return {
    organizationId: parsed.data.organization_id, branchId: parsed.data.branch_id,
    proposalId: parsed.data.proposal_id, proposalKey: parsed.data.proposal_key,
    proposalNumber: parsed.data.proposal_number, proposalAction: parsed.data.action,
    proposalStatus: "pending", targetMembershipId: parsed.data.target_membership_id,
    targetProfileId: parsed.data.target_profile_id,
    expectedMembershipVersion: parsed.data.expected_membership_version,
    contentHash: parsed.data.content_hash, requestedAt: parsed.data.requested_at,
    replayed: parsed.data.replayed, persisted: true, demo: false,
  };
}

export function parseStaffProposalDecisionReceipt(
  value: unknown, input: StaffProposalDecisionInput,
  expectedOrganizationId: string, expectedBranchId: string,
): StaffProposalDecisionReceipt {
  const parsed = decisionReceiptSchema.safeParse(value);
  const approved = input.decision === "approve";
  const termination = input.proposalAction === "terminate";
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId || parsed.data.proposal_id !== input.proposalId ||
    parsed.data.proposal_number !== input.expectedProposalNumber ||
    parsed.data.action !== input.proposalAction || parsed.data.decision !== input.decision ||
    parsed.data.proposal_status !== (approved ? "approved" : "rejected") ||
    parsed.data.target_membership_id !== input.expectedTargetMembershipId ||
    parsed.data.target_profile_id !== input.expectedTargetProfileId ||
    parsed.data.content_hash !== input.expectedContentHash ||
    (approved && (parsed.data.result_employment_version_id === null ||
      parsed.data.result_employment_version === null ||
      parsed.data.result_membership_version !== input.expectedMembershipVersion + 1)) ||
    (!approved && (parsed.data.result_employment_version_id !== null ||
      parsed.data.result_employment_version !== null ||
      parsed.data.result_membership_version !== null ||
      parsed.data.result_revocation_job_id !== null ||
      parsed.data.revocation_provider_status !== null ||
      parsed.data.revocation_verification_status !== null ||
      parsed.data.revocation_queued_at !== null ||
      parsed.data.revocation_deadline_at !== null)) ||
    (approved && termination && (parsed.data.result_revocation_job_id === null ||
      parsed.data.revocation_provider_status !== "not_configured" ||
      parsed.data.revocation_verification_status !== "not_verified" ||
      parsed.data.revocation_queued_at === null || parsed.data.revocation_deadline_at === null ||
      Date.parse(parsed.data.revocation_deadline_at) -
        Date.parse(parsed.data.revocation_queued_at) !== 5 * 60_000)) ||
    (approved && !termination && (parsed.data.result_revocation_job_id !== null ||
      parsed.data.revocation_provider_status !== null ||
      parsed.data.revocation_verification_status !== null ||
      parsed.data.revocation_queued_at !== null ||
      parsed.data.revocation_deadline_at !== null))) uncertain(
    "員工異動審核結果無法與待審版本核對；請保留相同操作鍵重試。",
  );
  return {
    organizationId: parsed.data.organization_id, branchId: parsed.data.branch_id,
    proposalId: parsed.data.proposal_id, proposalNumber: parsed.data.proposal_number,
    proposalAction: parsed.data.action, decision: parsed.data.decision,
    proposalStatus: parsed.data.proposal_status,
    targetMembershipId: parsed.data.target_membership_id,
    targetProfileId: parsed.data.target_profile_id,
    resultEmploymentVersionId: parsed.data.result_employment_version_id,
    resultEmploymentVersion: parsed.data.result_employment_version,
    resultMembershipVersion: parsed.data.result_membership_version,
    resultRevocationJobId: parsed.data.result_revocation_job_id,
    revocationProviderStatus: parsed.data.revocation_provider_status,
    revocationVerificationStatus: parsed.data.revocation_verification_status,
    revocationQueuedAt: parsed.data.revocation_queued_at,
    revocationDeadlineAt: parsed.data.revocation_deadline_at,
    contentHash: parsed.data.content_hash, decidedAt: parsed.data.decided_at,
    replayed: parsed.data.replayed, persisted: true, demo: false,
  };
}

export function parseStaffRoleRequestReceipt(
  value: unknown, input: StaffRoleChangeInput,
  expectedOrganizationId: string, expectedBranchId: string,
): StaffRoleRequestReceipt {
  const parsed = roleRequestReceiptSchema.safeParse(value);
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId || parsed.data.operation !== input.operation ||
    parsed.data.target_membership_id !== input.targetMembershipId ||
    parsed.data.target_role_id !== input.targetRoleId ||
    parsed.data.expected_membership_version !== input.expectedMembershipVersion) uncertain(
    "角色異動結果無法與送出內容核對；請保留相同操作鍵重試。",
  );
  return {
    organizationId: parsed.data.organization_id, branchId: parsed.data.branch_id,
    requestId: parsed.data.request_id, operation: parsed.data.operation,
    targetMembershipId: parsed.data.target_membership_id,
    targetRoleId: parsed.data.target_role_id,
    expectedMembershipVersion: parsed.data.expected_membership_version,
    requestStatus: "pending", requestHash: parsed.data.request_hash,
    requestedAt: parsed.data.requested_at, replayed: parsed.data.replayed,
    persisted: true, demo: false,
  };
}

export function parseStaffRoleApprovalReceipt(
  value: unknown, input: StaffRoleApprovalInput,
  expectedOrganizationId: string, expectedBranchId: string,
): StaffRoleApprovalReceipt {
  const parsed = roleApprovalReceiptSchema.safeParse(value);
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId || parsed.data.request_id !== input.requestId ||
    parsed.data.operation !== input.expectedOperation ||
    parsed.data.target_membership_id !== input.expectedTargetMembershipId ||
    parsed.data.target_role_id !== input.expectedTargetRoleId ||
    parsed.data.expected_membership_version !== input.expectedMembershipVersion ||
    parsed.data.result_membership_version !== input.expectedMembershipVersion + 1) uncertain(
    "角色核准結果無法與待審異動核對；請保留相同操作鍵重試。",
  );
  return {
    organizationId: parsed.data.organization_id, branchId: parsed.data.branch_id,
    requestId: parsed.data.request_id, operation: parsed.data.operation,
    targetMembershipId: parsed.data.target_membership_id,
    targetRoleId: parsed.data.target_role_id,
    expectedMembershipVersion: parsed.data.expected_membership_version,
    resultMembershipVersion: parsed.data.result_membership_version,
    requestStatus: "approved", appliedAt: parsed.data.applied_at,
    replayed: parsed.data.replayed, persisted: true, demo: false,
  };
}

function parseEnvelope(value: unknown) {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) uncertain("員工管理回應格式不完整。");
  return parsed.data.data;
}

function statusCheck(replayed: boolean, status: number) {
  if (status !== (replayed ? 200 : 201)) uncertain("HTTP 狀態與完成憑證不一致。");
}

export function parseStaffProposalApiEnvelope(
  value: unknown, input: StaffEmploymentProposalInput | StaffTerminationProposalInput,
  expectedOrganizationId: string, expectedBranchId: string, httpStatus: number,
) {
  const parsed = z.object({ receipt: apiProposalReceiptSchema,
    persisted: z.literal(true), demo: z.literal(false),
  }).strict().safeParse(parseEnvelope(value));
  if (!parsed.success) uncertain("員工異動提案回應內容不完整。");
  const receipt = parseStaffProposalReceipt({
    organization_id: parsed.data.receipt.organizationId,
    branch_id: parsed.data.receipt.branchId, proposal_id: parsed.data.receipt.proposalId,
    proposal_key: parsed.data.receipt.proposalKey,
    proposal_number: parsed.data.receipt.proposalNumber,
    action: parsed.data.receipt.proposalAction,
    proposal_status: parsed.data.receipt.proposalStatus,
    target_membership_id: parsed.data.receipt.targetMembershipId,
    target_profile_id: parsed.data.receipt.targetProfileId,
    expected_membership_version: parsed.data.receipt.expectedMembershipVersion,
    content_hash: parsed.data.receipt.contentHash,
    requested_at: parsed.data.receipt.requestedAt, replayed: parsed.data.receipt.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  statusCheck(receipt.replayed, httpStatus); return receipt;
}

export function parseStaffDecisionApiEnvelope(
  value: unknown, input: StaffProposalDecisionInput,
  expectedOrganizationId: string, expectedBranchId: string, httpStatus: number,
) {
  const parsed = z.object({ receipt: apiDecisionReceiptSchema,
    persisted: z.literal(true), demo: z.literal(false),
  }).strict().safeParse(parseEnvelope(value));
  if (!parsed.success) uncertain("員工異動審核回應內容不完整。");
  const item = parsed.data.receipt;
  const receipt = parseStaffProposalDecisionReceipt({
    organization_id: item.organizationId, branch_id: item.branchId,
    proposal_id: item.proposalId, proposal_number: item.proposalNumber,
    action: item.proposalAction, decision: item.decision,
    proposal_status: item.proposalStatus,
    target_membership_id: item.targetMembershipId,
    target_profile_id: item.targetProfileId,
    result_employment_version_id: item.resultEmploymentVersionId,
    result_employment_version: item.resultEmploymentVersion,
    result_membership_version: item.resultMembershipVersion,
    result_revocation_job_id: item.resultRevocationJobId,
    revocation_provider_status: item.revocationProviderStatus,
    revocation_verification_status: item.revocationVerificationStatus,
    revocation_queued_at: item.revocationQueuedAt,
    revocation_deadline_at: item.revocationDeadlineAt,
    content_hash: item.contentHash, decided_at: item.decidedAt,
    replayed: item.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  statusCheck(receipt.replayed, httpStatus); return receipt;
}

export function parseStaffRoleRequestApiEnvelope(
  value: unknown, input: StaffRoleChangeInput,
  expectedOrganizationId: string, expectedBranchId: string, httpStatus: number,
) {
  const parsed = z.object({ receipt: apiRoleRequestReceiptSchema,
    persisted: z.literal(true), demo: z.literal(false),
  }).strict().safeParse(parseEnvelope(value));
  if (!parsed.success) uncertain("角色異動回應內容不完整。");
  const item = parsed.data.receipt;
  const receipt = parseStaffRoleRequestReceipt({
    organization_id: item.organizationId, branch_id: item.branchId,
    request_id: item.requestId, operation: item.operation,
    target_membership_id: item.targetMembershipId, target_role_id: item.targetRoleId,
    expected_membership_version: item.expectedMembershipVersion,
    request_status: item.requestStatus, request_hash: item.requestHash,
    requested_at: item.requestedAt, replayed: item.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  statusCheck(receipt.replayed, httpStatus); return receipt;
}

export function parseStaffRoleApprovalApiEnvelope(
  value: unknown, input: StaffRoleApprovalInput,
  expectedOrganizationId: string, expectedBranchId: string, httpStatus: number,
) {
  const parsed = z.object({ receipt: apiRoleApprovalReceiptSchema,
    persisted: z.literal(true), demo: z.literal(false),
  }).strict().safeParse(parseEnvelope(value));
  if (!parsed.success) uncertain("角色核准回應內容不完整。");
  const item = parsed.data.receipt;
  const receipt = parseStaffRoleApprovalReceipt({
    organization_id: item.organizationId, branch_id: item.branchId,
    request_id: item.requestId, operation: item.operation,
    target_membership_id: item.targetMembershipId, target_role_id: item.targetRoleId,
    expected_membership_version: item.expectedMembershipVersion,
    result_membership_version: item.resultMembershipVersion,
    request_status: item.requestStatus, applied_at: item.appliedAt,
    replayed: item.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  statusCheck(receipt.replayed, httpStatus); return receipt;
}
