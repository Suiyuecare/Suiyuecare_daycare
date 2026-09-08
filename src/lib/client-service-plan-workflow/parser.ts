import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  CLIENT_SERVICE_PLAN_ACTIONS,
  CLIENT_SERVICE_PLAN_STATUSES,
  type ClientServicePlanContentMutationInput,
  type ClientServicePlanMutationInput,
  type ClientServicePlanPersistedPayload,
  type ClientServicePlanReceipt,
} from "./types";

export const CLIENT_SERVICE_PLAN_MUTATION_MAX_BYTES = 128 * 1024;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const instant = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(instant.getTime()) && new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant) === value;
});
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const clean = (maximum: number, minimum = 1) => z.string().trim().min(minimum).max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const positive = z.number().int().positive().max(1_000_000);

const inputGoal = z.object({ goal_id: uuid, item_order: z.number().int().min(1).max(50),
  goal: clean(1_000), target_outcome: clean(1_000) }).strict();
const inputMeasure = z.object({ measure_id: uuid, item_order: z.number().int().min(1).max(100),
  goal_id: uuid, measure: clean(2_000), frequency: clean(500), responsible_user_id: uuid }).strict();
const persistedGoal = inputGoal;
const persistedMeasure = inputMeasure.extend({ responsible_display_name: clean(120),
  qualification_status: z.literal("active_membership_only") }).strict();
const provenance = z.object({ schema_version: z.literal(1), source_system: z.literal("local"),
  capture_method: z.literal("staff_entry"), authority: z.literal("facility"),
  workflow: z.literal("page52_client_service_plan_v1"),
  legal_rule_status: z.literal("not_configured"),
  claim_eligibility_status: z.literal("blocked_not_configured") }).strict();

const identity = {
  client_id: uuid, plan_key: uuid, expected_terminal_id: uuid.nullable(),
  expected_terminal_version: z.number().int().min(0).max(1_000_000),
  expected_terminal_payload_hash: sha256.nullable(), expected_authorized_care_plan_id: uuid,
  expected_authorized_content_hash: sha256, reason: clean(1_000, 8),
};
const content = { effective_from: date, effective_to: date, review_due_on: date,
  responsible_user_id: uuid, goals: z.array(inputGoal).min(1).max(50),
  planned_services: z.array(inputMeasure).min(1).max(100) };
const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_draft"), ...identity, ...content }).strict(),
  z.object({ action: z.literal("revise_draft"), ...identity, ...content }).strict(),
  ...(["approve", "sign", "void"] as const).map((action) => z.object({
    action: z.literal(action), ...identity, effective_from: z.null(), effective_to: z.null(),
    review_due_on: z.null(), responsible_user_id: z.null(), goals: z.null(),
    planned_services: z.null(),
  }).strict()),
]);

const persistedPayload = z.object({ schema_version: z.literal(1), organization_id: uuid,
  branch_id: uuid, client_id: uuid, plan_key: uuid, version: positive,
  previous_version_id: uuid.nullable(), status: z.enum(CLIENT_SERVICE_PLAN_STATUSES),
  authorized_care_plan_id: uuid, authorized_content_hash: sha256, effective_from: date,
  effective_to: date, review_due_on: date, responsible_user_id: uuid,
  source_system: z.literal("local"), source_record_id: z.null(), source_provenance: provenance,
  goals: z.array(persistedGoal).min(1).max(50),
  planned_services: z.array(persistedMeasure).min(1).max(100), reason: clean(1_000, 8),
}).strict();

const receipt = z.object({ operation_id: uuid, action: z.enum(CLIENT_SERVICE_PLAN_ACTIONS),
  plan_id: uuid, plan_key: uuid, version: positive, previous_version_id: uuid.nullable(),
  status: z.enum(CLIENT_SERVICE_PLAN_STATUSES), client_id: uuid,
  authorized_care_plan_id: uuid, authorized_content_hash: sha256,
  previous_payload_hash: sha256.nullable(), payload_hash: sha256,
  persisted_payload: persistedPayload, committed_at: timestamp, replayed: z.boolean(),
  legal_rule_status: z.literal("not_configured"),
  claim_eligibility_status: z.literal("blocked_not_configured"),
}).strict();
const apiPersistedPayload = z.object({ schemaVersion: z.literal(1), organizationId: uuid,
  branchId: uuid, clientId: uuid, planKey: uuid, version: positive,
  previousVersionId: uuid.nullable(), status: z.enum(CLIENT_SERVICE_PLAN_STATUSES),
  authorizedCarePlanId: uuid, authorizedContentHash: sha256, effectiveFrom: date,
  effectiveTo: date, reviewDueOn: date, responsibleUserId: uuid,
  sourceSystem: z.literal("local"), sourceRecordId: z.null(),
  sourceProvenance: z.object({ schemaVersion: z.literal(1), sourceSystem: z.literal("local"),
    captureMethod: z.literal("staff_entry"), authority: z.literal("facility"),
    workflow: z.literal("page52_client_service_plan_v1"), legalRuleStatus: z.literal("not_configured"),
    claimEligibilityStatus: z.literal("blocked_not_configured") }).strict(),
  goals: z.array(z.object({ goalId: uuid, itemOrder: positive, goal: clean(1_000),
    targetOutcome: clean(1_000) }).strict()).min(1).max(50),
  plannedServices: z.array(z.object({ measureId: uuid, itemOrder: positive, goalId: uuid,
    measure: clean(2_000), frequency: clean(500), responsibleUserId: uuid,
    responsibleDisplayName: clean(120), qualificationStatus: z.literal("active_membership_only")
  }).strict()).min(1).max(100), reason: clean(1_000, 8) }).strict();
const apiReceipt = z.object({ operationId: uuid, action: z.enum(CLIENT_SERVICE_PLAN_ACTIONS),
  planId: uuid, planKey: uuid, version: positive, previousVersionId: uuid.nullable(),
  status: z.enum(CLIENT_SERVICE_PLAN_STATUSES), clientId: uuid, authorizedCarePlanId: uuid,
  authorizedContentHash: sha256, previousPayloadHash: sha256.nullable(), payloadHash: sha256,
  persistedPayload: apiPersistedPayload, committedAt: timestamp, replayed: z.boolean(),
  legalRuleStatus: z.literal("not_configured"),
  claimEligibilityStatus: z.literal("blocked_not_configured"),
  persisted: z.literal(true), demo: z.literal(false) }).strict();
const apiEnvelope = z.object({ requestId: uuid, status: z.literal("ok"),
  data: apiReceipt, errors: z.array(z.never()).length(0) }).strict();

function invalid(message: string): never {
  throw new IntegrationError("INVALID_CLIENT_SERVICE_PLAN_OPERATION", message, 400);
}

function uncertain(): never {
  throw new IntegrationError("CLIENT_SERVICE_PLAN_RECEIPT_INVALID",
    "個案服務計畫保存回執無法與送出版本核對；請保留相同內容與操作鍵重試。", 502);
}

function ensureStructuredContent(value: z.output<typeof mutation>) {
  if (value.action !== "create_draft" && value.action !== "revise_draft") return;
  if (value.effective_from > value.effective_to || value.review_due_on < value.effective_from ||
    value.review_due_on > value.effective_to) invalid("生效、結束與檢討日期的先後順序不正確。");
  const goals = value.goals.map((item) => item.goal_id);
  const goalOrders = value.goals.map((item) => item.item_order);
  const measures = value.planned_services.map((item) => item.measure_id);
  const measureOrders = value.planned_services.map((item) => item.item_order);
  const ordered = (items: readonly number[]) => [...items].sort((a, b) => a - b)
    .every((item, index) => item === index + 1);
  if (new Set(goals).size !== goals.length || new Set(measures).size !== measures.length ||
    !ordered(goalOrders) || !ordered(measureOrders) || value.planned_services.some(
      (item) => !goals.includes(item.goal_id))) invalid("目標與措施的識別碼、順序或對應關係不正確。");
}

function mapContent(value: z.output<typeof mutation>): ClientServicePlanContentMutationInput | null {
  if (value.action !== "create_draft" && value.action !== "revise_draft") return null;
  return { action: value.action, clientId: value.client_id, planKey: value.plan_key,
    expectedTerminalId: value.expected_terminal_id,
    expectedTerminalVersion: value.expected_terminal_version,
    expectedTerminalPayloadHash: value.expected_terminal_payload_hash,
    expectedAuthorizedCarePlanId: value.expected_authorized_care_plan_id,
    expectedAuthorizedContentHash: value.expected_authorized_content_hash,
    effectiveFrom: value.effective_from, effectiveTo: value.effective_to,
    reviewDueOn: value.review_due_on, responsibleUserId: value.responsible_user_id,
    goals: value.goals.map((item) => ({ goalId: item.goal_id, itemOrder: item.item_order,
      goal: item.goal, targetOutcome: item.target_outcome })),
    plannedServices: value.planned_services.map((item) => ({ measureId: item.measure_id,
      itemOrder: item.item_order, goalId: item.goal_id, measure: item.measure,
      frequency: item.frequency, responsibleUserId: item.responsible_user_id })),
    reason: value.reason, idempotencyKey: "",
  };
}

export function parseClientServicePlanMutation(
  value: unknown,
  idempotencyHeader: string | null,
): ClientServicePlanMutationInput {
  const key = uuid.safeParse(idempotencyHeader);
  const parsed = mutation.safeParse(value);
  if (!key.success || !parsed.success) invalid("請完整填寫操作、版本、核定來源、日期、目標、措施與理由。");
  const row = parsed.data;
  ensureStructuredContent(row);
  const creating = row.action === "create_draft";
  if ((creating && (row.expected_terminal_id !== null || row.expected_terminal_version !== 0 ||
    row.expected_terminal_payload_hash !== null)) || (!creating &&
    (row.expected_terminal_id === null || row.expected_terminal_version < 1 ||
      row.expected_terminal_payload_hash === null))) invalid("個案服務計畫版本基準不一致。");
  if (row.action === "create_draft" || row.action === "revise_draft") {
    const mapped = mapContent(row);
    if (!mapped) invalid("個案服務計畫內容型態不一致。");
    return { ...mapped, idempotencyKey: key.data };
  }
  return { action: row.action, clientId: row.client_id, planKey: row.plan_key,
    expectedTerminalId: row.expected_terminal_id, expectedTerminalVersion: row.expected_terminal_version,
    expectedTerminalPayloadHash: row.expected_terminal_payload_hash,
    expectedAuthorizedCarePlanId: row.expected_authorized_care_plan_id,
    expectedAuthorizedContentHash: row.expected_authorized_content_hash,
    effectiveFrom: null, effectiveTo: null, reviewDueOn: null, responsibleUserId: null,
    goals: null, plannedServices: null, reason: row.reason, idempotencyKey: key.data };
}

export function clientServicePlanMutationArgs(input: ClientServicePlanMutationInput) {
  const contentInput = input.action === "create_draft" || input.action === "revise_draft";
  return {
    p_action: input.action, p_client_id: input.clientId, p_plan_key: input.planKey,
    p_expected_terminal_id: input.expectedTerminalId,
    p_expected_terminal_version: input.expectedTerminalVersion,
    p_expected_terminal_payload_hash: input.expectedTerminalPayloadHash,
    p_expected_authorized_care_plan_id: input.expectedAuthorizedCarePlanId,
    p_expected_authorized_content_hash: input.expectedAuthorizedContentHash,
    p_effective_from: contentInput ? input.effectiveFrom : null,
    p_effective_to: contentInput ? input.effectiveTo : null,
    p_review_due_on: contentInput ? input.reviewDueOn : null,
    p_responsible_user_id: contentInput ? input.responsibleUserId : null,
    p_goals: contentInput ? input.goals.map((item) => ({ goal_id: item.goalId,
      item_order: item.itemOrder, goal: item.goal, target_outcome: item.targetOutcome })) : null,
    p_planned_services: contentInput ? input.plannedServices.map((item) => ({
      measure_id: item.measureId, item_order: item.itemOrder, goal_id: item.goalId,
      measure: item.measure, frequency: item.frequency,
      responsible_user_id: item.responsibleUserId })) : null,
    p_reason: input.reason, p_idempotency_key: input.idempotencyKey,
  };
}

function mapPersisted(value: z.output<typeof persistedPayload>): ClientServicePlanPersistedPayload {
  return { schemaVersion: 1, organizationId: value.organization_id, branchId: value.branch_id,
    clientId: value.client_id, planKey: value.plan_key, version: value.version,
    previousVersionId: value.previous_version_id, status: value.status,
    authorizedCarePlanId: value.authorized_care_plan_id,
    authorizedContentHash: value.authorized_content_hash, effectiveFrom: value.effective_from,
    effectiveTo: value.effective_to, reviewDueOn: value.review_due_on,
    responsibleUserId: value.responsible_user_id, sourceSystem: "local", sourceRecordId: null,
    sourceProvenance: { schemaVersion: 1, sourceSystem: "local",
      captureMethod: "staff_entry", authority: "facility",
      workflow: "page52_client_service_plan_v1", legalRuleStatus: "not_configured",
      claimEligibilityStatus: "blocked_not_configured" },
    goals: value.goals.map((item) => ({ goalId: item.goal_id, itemOrder: item.item_order,
      goal: item.goal, targetOutcome: item.target_outcome })),
    plannedServices: value.planned_services.map((item) => ({ measureId: item.measure_id,
      itemOrder: item.item_order, goalId: item.goal_id, measure: item.measure,
      frequency: item.frequency, responsibleUserId: item.responsible_user_id,
      responsibleDisplayName: item.responsible_display_name,
      qualificationStatus: item.qualification_status })), reason: value.reason };
}

export function parseClientServicePlanReceipt(
  value: unknown,
  input: ClientServicePlanMutationInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
): ClientServicePlanReceipt {
  const parsed = receipt.safeParse(value);
  if (!parsed.success) uncertain();
  const row = parsed.data;
  const payload = mapPersisted(row.persisted_payload);
  const result: ClientServicePlanReceipt = { operationId: row.operation_id, action: row.action,
    planId: row.plan_id, planKey: row.plan_key, version: row.version,
    previousVersionId: row.previous_version_id, status: row.status, clientId: row.client_id,
    authorizedCarePlanId: row.authorized_care_plan_id,
    authorizedContentHash: row.authorized_content_hash,
    previousPayloadHash: row.previous_payload_hash, payloadHash: row.payload_hash,
    persistedPayload: payload, committedAt: row.committed_at, replayed: row.replayed,
    legalRuleStatus: row.legal_rule_status, claimEligibilityStatus: row.claim_eligibility_status,
    persisted: true, demo: false };
  return validateReceipt(result, input, expectedOrganizationId, expectedBranchId);
}

function validateReceipt(result: ClientServicePlanReceipt, input: ClientServicePlanMutationInput,
  expectedOrganizationId: string, expectedBranchId: string) {
  const expectedStatus: Record<ClientServicePlanMutationInput["action"], ClientServicePlanReceipt["status"]> = {
    create_draft: "draft", revise_draft: "draft", approve: "approved", sign: "signed", void: "voided",
  };
  const expectedVersion = input.action === "create_draft" ? 1 : input.expectedTerminalVersion + 1;
  const contentInput = input.action === "create_draft" || input.action === "revise_draft";
  const payload = result.persistedPayload;
  const contentMatches = !contentInput || (payload.effectiveFrom === input.effectiveFrom &&
    payload.effectiveTo === input.effectiveTo && payload.reviewDueOn === input.reviewDueOn &&
    payload.responsibleUserId === input.responsibleUserId && JSON.stringify(payload.goals) === JSON.stringify(input.goals) &&
    payload.plannedServices.length === input.plannedServices.length && payload.plannedServices.every((item, index) => {
      const expected = input.plannedServices[index];
      return expected !== undefined && item.measureId === expected.measureId &&
        item.itemOrder === expected.itemOrder && item.goalId === expected.goalId &&
        item.measure === expected.measure && item.frequency === expected.frequency &&
        item.responsibleUserId === expected.responsibleUserId;
    }));
  if (result.action !== input.action || result.planKey !== input.planKey || result.clientId !== input.clientId ||
    result.version !== expectedVersion || result.previousVersionId !== input.expectedTerminalId ||
    result.status !== expectedStatus[input.action] || result.authorizedCarePlanId !== input.expectedAuthorizedCarePlanId ||
    result.authorizedContentHash !== input.expectedAuthorizedContentHash ||
    result.previousPayloadHash !== input.expectedTerminalPayloadHash ||
    payload.organizationId !== expectedOrganizationId.toLowerCase() ||
    payload.branchId !== expectedBranchId.toLowerCase() || payload.clientId !== result.clientId ||
    payload.planKey !== result.planKey || payload.version !== result.version ||
    payload.previousVersionId !== result.previousVersionId || payload.status !== result.status ||
    payload.authorizedCarePlanId !== result.authorizedCarePlanId ||
    payload.authorizedContentHash !== result.authorizedContentHash || payload.reason !== input.reason ||
    !contentMatches) uncertain();
  return result;
}

export function parseClientServicePlanApiReceipt(value: unknown,
  input: ClientServicePlanMutationInput, expectedOrganizationId: string,
  expectedBranchId: string): ClientServicePlanReceipt {
  const parsed = apiReceipt.safeParse(value);
  if (!parsed.success) uncertain();
  return validateReceipt(parsed.data, input, expectedOrganizationId, expectedBranchId);
}

export function parseClientServicePlanApiEnvelope(value: unknown, httpStatus: number,
  input: ClientServicePlanMutationInput, expectedOrganizationId: string,
  expectedBranchId: string): ClientServicePlanReceipt {
  const parsed = apiEnvelope.safeParse(value);
  if (!parsed.success) uncertain();
  const result = validateReceipt(parsed.data.data, input, expectedOrganizationId, expectedBranchId);
  if ((result.replayed && httpStatus !== 200) || (!result.replayed && httpStatus !== 201)) uncertain();
  return result;
}
