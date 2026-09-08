import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import { isOrganizationProfileDate } from "./date";
import type {
  OrganizationProfileDecisionInput,
  OrganizationProfileDecisionReceipt,
  OrganizationProfileProposalInput,
  OrganizationProfileProposalReceipt,
} from "./types";

export const ORGANIZATION_PROFILE_PROPOSAL_MAX_BYTES = 96 * 1024;
export const ORGANIZATION_PROFILE_DECISION_MAX_BYTES = 8 * 1024;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().refine(isOrganizationProfileDate);
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const optionalClean = (max: number, multiline = false) =>
  clean(max, multiline).nullable();
const decimalText = z.string().trim().regex(/^[0-9]{1,18}(?:\.[0-9]{1,6})?$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const email = z.string().trim().email().max(254).nullable();

const serviceSchema = z.object({
  service_key: uuid,
  name: clean(160),
  description: optionalClean(1_000, true),
  taxonomy_status: z.literal("manual_unstandardized"),
}).strict();

const rateSchema = z.object({
  rate_key: uuid,
  label: clean(160),
  amount_decimal_text: decimalText,
  currency_code: z.string().regex(/^[A-Z]{3}$/u),
  effective_from: date,
  effective_to: date.nullable(),
  taxonomy_status: z.literal("manual_unstandardized"),
}).strict();

const contentShape = {
  effective_from: date,
  effective_to: date.nullable(),
  permit_number: clean(160),
  permit_issuing_authority: clean(200),
  permit_issued_on: date,
  permit_valid_through: date.nullable(),
  permit_status_text: clean(160),
  organization_type_text: clean(160),
  service_items: z.array(serviceSchema).max(50),
  rate_items: z.array(rateSchema).max(100),
  approved_capacity: z.number().int().min(1).max(1_000_000).safe(),
  capacity_unit_text: clean(40),
  capacity_basis_text: clean(500, true),
  contact_name: clean(160),
  contact_phone: clean(80),
  contact_email: email,
  contact_address: clean(500, true),
  change_reason: clean(1_000, true),
};

const proposalSchema = z.discriminatedUnion("proposal_action", [
  z.object({ action: z.literal("propose"), proposal_action: z.literal("create"),
    proposal_key: uuid, profile_key: uuid, base_version_id: z.null(),
    expected_base_version: z.literal(0), ...contentShape,
  }).strict(),
  z.object({ action: z.literal("propose"), proposal_action: z.literal("correct"),
    proposal_key: uuid, profile_key: uuid, base_version_id: uuid,
    expected_base_version: z.number().int().positive().safe(), ...contentShape,
  }).strict(),
]);

const decisionSchema = z.object({
  action: z.literal("decide"),
  proposal_id: uuid,
  expected_proposal_number: z.number().int().positive().safe(),
  expected_base_version: z.number().int().nonnegative().safe(),
  expected_profile_key: uuid,
  expected_content_hash: hash,
  expected_effective_from: date,
  expected_effective_to: date.nullable(),
  decision: z.enum(["approve", "reject"]),
  decision_reason: clean(1_000, true),
}).strict();

const proposalReceiptSchema = z.object({
  organization_id: uuid, branch_id: uuid, proposal_id: uuid,
  proposal_key: uuid, proposal_number: z.number().int().positive().safe(),
  proposal_status: z.literal("pending"), action: z.enum(["create", "correct"]),
  profile_key: uuid, expected_base_version: z.number().int().nonnegative().safe(),
  content_hash: hash, proposed_at: timestamp, replayed: z.boolean(),
}).strict();

const decisionReceiptSchema = z.object({
  organization_id: uuid, branch_id: uuid, proposal_id: uuid,
  decision_id: uuid, decision: z.enum(["approve", "reject"]),
  proposal_status: z.enum(["approved", "rejected"]),
  result_version_id: uuid.nullable(), profile_key: uuid,
  result_version: z.number().int().positive().safe().nullable(),
  effective_from: date.nullable(), effective_to: date.nullable(),
  content_hash: hash, decided_at: timestamp, replayed: z.boolean(),
}).strict();

const apiProposalReceiptSchema = z.object({
  organizationId: uuid, branchId: uuid, proposalId: uuid,
  proposalKey: uuid, proposalNumber: z.number().int().positive().safe(),
  proposalStatus: z.literal("pending"), proposalAction: z.enum(["create", "correct"]),
  profileKey: uuid, expectedBaseVersion: z.number().int().nonnegative().safe(),
  contentHash: hash, proposedAt: timestamp, replayed: z.boolean(),
  persisted: z.literal(true), demo: z.literal(false),
}).strict();

const apiDecisionReceiptSchema = z.object({
  organizationId: uuid, branchId: uuid, proposalId: uuid,
  decisionId: uuid, decision: z.enum(["approve", "reject"]),
  proposalStatus: z.enum(["approved", "rejected"]),
  resultVersionId: uuid.nullable(), profileKey: uuid,
  resultVersion: z.number().int().positive().safe().nullable(),
  effectiveFrom: date.nullable(), effectiveTo: date.nullable(),
  contentHash: hash, decidedAt: timestamp, replayed: z.boolean(),
  persisted: z.literal(true), demo: z.literal(false),
}).strict();

const envelopeSchema = z.object({
  requestId: uuid, status: z.literal("ok"), data: z.unknown(),
  errors: z.array(z.never()).length(0),
}).strict();

function invalid(message: string): never {
  throw new IntegrationError("INVALID_ORGANIZATION_PROFILE_INPUT", message, 400);
}

function uncertain(message: string): never {
  throw new IntegrationError("ORGANIZATION_PROFILE_RECEIPT_INVALID", message, 409);
}

function validateContent(body: z.output<typeof proposalSchema>) {
  if (body.effective_to !== null && body.effective_to < body.effective_from) {
    invalid("機構資料生效迄日不可早於生效起日。");
  }
  if (body.permit_valid_through !== null &&
    body.permit_valid_through < body.permit_issued_on) {
    invalid("許可有效迄日不可早於許可發出日。");
  }
  const serviceKeys = body.service_items.map((item) => item.service_key);
  const serviceNames = body.service_items.map((item) => item.name.toLocaleLowerCase("zh-TW"));
  if (new Set(serviceKeys).size !== serviceKeys.length ||
    new Set(serviceNames).size !== serviceNames.length) {
    invalid("同一提案內的服務識別或服務名稱不可重複。");
  }
  const rateKeys = body.rate_items.map((item) => item.rate_key);
  if (new Set(rateKeys).size !== rateKeys.length) invalid(
    "同一提案內的費率識別不可重複。",
  );
  for (const [index, rate] of body.rate_items.entries()) {
    if (rate.effective_to !== null && rate.effective_to < rate.effective_from) {
      invalid("費率生效迄日不可早於生效起日。");
    }
    for (const other of body.rate_items.slice(index + 1)) {
      const sameKind = rate.label.toLocaleLowerCase("zh-TW") ===
        other.label.toLocaleLowerCase("zh-TW") &&
        rate.currency_code === other.currency_code;
      const overlaps = rate.effective_from <= (other.effective_to ?? "9999-12-31") &&
        other.effective_from <= (rate.effective_to ?? "9999-12-31");
      if (sameKind && overlaps) invalid(
        "同一人工費目與幣別的生效期間不可重疊。",
      );
    }
  }
}

export function parseOrganizationProfileProposalInput(
  value: unknown,
  idempotencyHeader: string | null,
): OrganizationProfileProposalInput {
  const key = uuid.safeParse(idempotencyHeader);
  const parsed = proposalSchema.safeParse(value);
  if (!key.success || !parsed.success) invalid(
    "請完整填寫許可、類型、服務、費率、容量、聯絡、生效版本與操作鍵。",
  );
  validateContent(parsed.data);
  const body = parsed.data;
  return {
    action: "propose", proposalAction: body.proposal_action,
    proposalKey: body.proposal_key, profileKey: body.profile_key,
    baseVersionId: body.base_version_id,
    expectedBaseVersion: body.expected_base_version,
    content: {
      effectiveFrom: body.effective_from, effectiveTo: body.effective_to,
      permitNumber: body.permit_number,
      permitIssuingAuthority: body.permit_issuing_authority,
      permitIssuedOn: body.permit_issued_on,
      permitValidThrough: body.permit_valid_through,
      permitStatusText: body.permit_status_text,
      organizationTypeText: body.organization_type_text,
      serviceItems: body.service_items.map((item) => ({
        serviceKey: item.service_key, name: item.name,
        description: item.description,
        taxonomyStatus: item.taxonomy_status,
      })),
      rateItems: body.rate_items.map((item) => ({
        rateKey: item.rate_key, label: item.label,
        amountDecimalText: item.amount_decimal_text,
        currencyCode: item.currency_code,
        effectiveFrom: item.effective_from, effectiveTo: item.effective_to,
        taxonomyStatus: item.taxonomy_status,
      })),
      approvedCapacity: body.approved_capacity,
      capacityUnitText: body.capacity_unit_text,
      capacityBasisText: body.capacity_basis_text,
      contactName: body.contact_name, contactPhone: body.contact_phone,
      contactEmail: body.contact_email, contactAddress: body.contact_address,
      changeReason: body.change_reason,
    }, idempotencyKey: key.data,
  };
}

export function parseOrganizationProfileDecisionInput(
  value: unknown,
  idempotencyHeader: string | null,
): OrganizationProfileDecisionInput {
  const key = uuid.safeParse(idempotencyHeader);
  const parsed = decisionSchema.safeParse(value);
  if (!key.success || !parsed.success) invalid(
    "請提供待審提案、預期版本、決定、理由與操作鍵。",
  );
  if (parsed.data.expected_effective_to !== null &&
    parsed.data.expected_effective_to < parsed.data.expected_effective_from) {
    invalid("待審提案的預期生效期間無效。");
  }
  return {
    action: "decide", proposalId: parsed.data.proposal_id,
    expectedProposalNumber: parsed.data.expected_proposal_number,
    expectedBaseVersion: parsed.data.expected_base_version,
    expectedProfileKey: parsed.data.expected_profile_key,
    expectedContentHash: parsed.data.expected_content_hash,
    expectedEffectiveFrom: parsed.data.expected_effective_from,
    expectedEffectiveTo: parsed.data.expected_effective_to,
    decision: parsed.data.decision,
    decisionReason: parsed.data.decision_reason,
    idempotencyKey: key.data,
  };
}

export function parseOrganizationProfileProposalReceipt(
  value: unknown,
  input: OrganizationProfileProposalInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
): OrganizationProfileProposalReceipt {
  const parsed = proposalReceiptSchema.safeParse(value);
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId ||
    parsed.data.proposal_key !== input.proposalKey ||
    parsed.data.action !== input.proposalAction ||
    parsed.data.profile_key !== input.profileKey ||
    parsed.data.expected_base_version !== input.expectedBaseVersion) uncertain(
    "機構資料提案結果無法與送出內容核對；請保留相同操作鍵重試。",
  );
  return {
    organizationId: parsed.data.organization_id,
    branchId: parsed.data.branch_id, proposalId: parsed.data.proposal_id,
    proposalKey: parsed.data.proposal_key,
    proposalNumber: parsed.data.proposal_number,
    proposalStatus: "pending", proposalAction: parsed.data.action,
    profileKey: parsed.data.profile_key,
    expectedBaseVersion: parsed.data.expected_base_version,
    contentHash: parsed.data.content_hash, proposedAt: parsed.data.proposed_at,
    replayed: parsed.data.replayed, persisted: true, demo: false,
  };
}

export function parseOrganizationProfileDecisionReceipt(
  value: unknown,
  input: OrganizationProfileDecisionInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
): OrganizationProfileDecisionReceipt {
  const parsed = decisionReceiptSchema.safeParse(value);
  const approved = input.decision === "approve";
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId ||
    parsed.data.proposal_id !== input.proposalId ||
    parsed.data.decision !== input.decision ||
    parsed.data.proposal_status !== (approved ? "approved" : "rejected") ||
    parsed.data.profile_key !== input.expectedProfileKey ||
    parsed.data.content_hash !== input.expectedContentHash ||
    (approved && (parsed.data.result_version_id === null ||
      parsed.data.result_version !== input.expectedBaseVersion + 1 ||
      parsed.data.effective_from !== input.expectedEffectiveFrom ||
      parsed.data.effective_to !== input.expectedEffectiveTo)) ||
    (!approved && (parsed.data.result_version_id !== null ||
      parsed.data.result_version !== null || parsed.data.effective_from !== null ||
      parsed.data.effective_to !== null))) uncertain(
    "機構資料審核結果無法與待審版本核對；請保留相同操作鍵重試。",
  );
  return {
    organizationId: parsed.data.organization_id,
    branchId: parsed.data.branch_id, proposalId: parsed.data.proposal_id,
    decisionId: parsed.data.decision_id, decision: parsed.data.decision,
    proposalStatus: parsed.data.proposal_status,
    resultVersionId: parsed.data.result_version_id,
    profileKey: parsed.data.profile_key,
    resultVersion: parsed.data.result_version,
    effectiveFrom: parsed.data.effective_from,
    effectiveTo: parsed.data.effective_to,
    contentHash: parsed.data.content_hash, decidedAt: parsed.data.decided_at,
    replayed: parsed.data.replayed, persisted: true, demo: false,
  };
}

function parseEnvelope(value: unknown) {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) uncertain("機構資料回應格式不完整。");
  return parsed.data.data;
}

export function parseOrganizationProfileProposalApiEnvelope(
  value: unknown, input: OrganizationProfileProposalInput,
  expectedOrganizationId: string, expectedBranchId: string, httpStatus: number,
) {
  const parsed = z.object({ receipt: apiProposalReceiptSchema,
    persisted: z.literal(true), demo: z.literal(false),
  }).strict().safeParse(parseEnvelope(value));
  if (!parsed.success) uncertain("機構資料提案回應內容不完整。");
  const receipt = parseOrganizationProfileProposalReceipt({
    organization_id: parsed.data.receipt.organizationId,
    branch_id: parsed.data.receipt.branchId,
    proposal_id: parsed.data.receipt.proposalId,
    proposal_key: parsed.data.receipt.proposalKey,
    proposal_number: parsed.data.receipt.proposalNumber,
    proposal_status: parsed.data.receipt.proposalStatus,
    action: parsed.data.receipt.proposalAction,
    profile_key: parsed.data.receipt.profileKey,
    expected_base_version: parsed.data.receipt.expectedBaseVersion,
    content_hash: parsed.data.receipt.contentHash,
    proposed_at: parsed.data.receipt.proposedAt,
    replayed: parsed.data.receipt.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  if (httpStatus !== (receipt.replayed ? 200 : 201)) uncertain(
    "機構資料提案 HTTP 狀態與完成憑證不一致。",
  );
  return receipt;
}

export function parseOrganizationProfileDecisionApiEnvelope(
  value: unknown, input: OrganizationProfileDecisionInput,
  expectedOrganizationId: string, expectedBranchId: string, httpStatus: number,
) {
  const parsed = z.object({ receipt: apiDecisionReceiptSchema,
    persisted: z.literal(true), demo: z.literal(false),
  }).strict().safeParse(parseEnvelope(value));
  if (!parsed.success) uncertain("機構資料審核回應內容不完整。");
  const receipt = parseOrganizationProfileDecisionReceipt({
    organization_id: parsed.data.receipt.organizationId,
    branch_id: parsed.data.receipt.branchId,
    proposal_id: parsed.data.receipt.proposalId,
    decision_id: parsed.data.receipt.decisionId,
    decision: parsed.data.receipt.decision,
    proposal_status: parsed.data.receipt.proposalStatus,
    result_version_id: parsed.data.receipt.resultVersionId,
    profile_key: parsed.data.receipt.profileKey,
    result_version: parsed.data.receipt.resultVersion,
    effective_from: parsed.data.receipt.effectiveFrom,
    effective_to: parsed.data.receipt.effectiveTo,
    content_hash: parsed.data.receipt.contentHash,
    decided_at: parsed.data.receipt.decidedAt,
    replayed: parsed.data.receipt.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  if (httpStatus !== (receipt.replayed ? 200 : 201)) uncertain(
    "機構資料審核 HTTP 狀態與完成憑證不一致。",
  );
  return receipt;
}
