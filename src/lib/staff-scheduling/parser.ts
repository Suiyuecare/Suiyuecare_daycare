import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import type {
  DecideStaffScheduleInput,
  DecideStaffScheduleReceipt,
  SubmitStaffScheduleInput,
  SubmitStaffScheduleReceipt,
} from "./types";

export const STAFF_SCHEDULING_ACTION_HEADER = "x-staff-scheduling-action";
export const STAFF_SCHEDULING_SUBMIT_MAX_BYTES = 24 * 1024;
export const STAFF_SCHEDULING_DECISION_MAX_BYTES = 8 * 1024;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const code = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u);
const positive = z.number().int().positive().safe();
const count = z.number().int().nonnegative().safe();

const submit = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"), schedule_key: uuid,
    previous_version_id: z.null(), expected_version: z.literal(0),
    expected_content_hash: z.null(), staff_membership_id: uuid,
    starts_at: timestamp, ends_at: timestamp, role_text: clean(160),
    service_need_text: clean(500, true), facility_code: code, vehicle_code: code,
    planned_clients: positive, revision_reason: clean(1_000, true),
  }).strict(),
  z.object({
    action: z.literal("revise"), schedule_key: uuid,
    previous_version_id: uuid, expected_version: positive,
    expected_content_hash: hash, staff_membership_id: uuid,
    starts_at: timestamp, ends_at: timestamp, role_text: clean(160),
    service_need_text: clean(500, true), facility_code: code, vehicle_code: code,
    planned_clients: positive, revision_reason: clean(1_000, true),
  }).strict(),
]);
const decision = z.object({
  action: z.literal("decide"), schedule_version_id: uuid,
  expected_schedule_key: uuid, expected_version: positive,
  expected_content_hash: hash, expected_conflict_count: count,
  expected_rule_version_id: uuid,
  decision: z.enum(["publish", "override", "reject"]),
  reason: clean(1_000, true),
}).strict();

const submitReceipt = z.object({
  organization_id: uuid, branch_id: uuid, schedule_key: uuid,
  schedule_version_id: uuid, schedule_version: positive,
  schedule_status: z.enum(["draft_ready", "draft_conflicted"]),
  staff_membership_id: uuid, rule_version_id: uuid, conflict_count: count,
  content_hash: hash, committed_at: timestamp, replayed: z.boolean(),
}).strict();
const decisionReceipt = z.object({
  organization_id: uuid, branch_id: uuid, schedule_key: uuid,
  decided_version_id: uuid, expected_version: positive, decision_id: uuid,
  decision: z.enum(["publish", "override", "reject"]), result_version_id: uuid,
  result_version: positive, result_status: z.enum(["published", "voided"]),
  review_mode: z.enum(["standard", "override", "rejected"]),
  conflict_count: count, rule_version_id: uuid, content_hash: hash,
  decided_at: timestamp, replayed: z.boolean(),
}).strict();

const apiSubmitReceipt = z.object({
  organizationId: uuid, branchId: uuid, scheduleKey: uuid,
  scheduleVersionId: uuid, scheduleVersion: positive,
  scheduleStatus: z.enum(["draft_ready", "draft_conflicted"]),
  staffMembershipId: uuid, ruleVersionId: uuid, conflictCount: count,
  contentHash: hash, committedAt: timestamp, replayed: z.boolean(),
  persisted: z.literal(true), demo: z.literal(false),
}).strict();
const apiDecisionReceipt = z.object({
  organizationId: uuid, branchId: uuid, scheduleKey: uuid,
  decidedVersionId: uuid, expectedVersion: positive, decisionId: uuid,
  decision: z.enum(["publish", "override", "reject"]), resultVersionId: uuid,
  resultVersion: positive, resultStatus: z.enum(["published", "voided"]),
  reviewMode: z.enum(["standard", "override", "rejected"]),
  conflictCount: count, ruleVersionId: uuid, contentHash: hash,
  decidedAt: timestamp, replayed: z.boolean(),
  persisted: z.literal(true), demo: z.literal(false),
}).strict();
const envelope = z.object({
  requestId: uuid, status: z.literal("ok"), data: z.unknown(),
  errors: z.array(z.never()).length(0),
}).strict();

function invalid(message: string): never {
  throw new IntegrationError("INVALID_STAFF_SCHEDULING_INPUT", message, 400);
}
function uncertain(message: string): never {
  throw new IntegrationError("STAFF_SCHEDULING_RECEIPT_INVALID", message, 409);
}
function parseKey(value: string | null) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) invalid("請提供有效且固定的操作鍵。");
  return parsed.data;
}
function validateDuration(startsAt: string, endsAt: string) {
  const duration = Date.parse(endsAt) - Date.parse(startsAt);
  if (duration <= 0 || duration > 7 * 86_400_000) {
    invalid("結束時間必須晚於開始時間，且單一班次不得超過 7 天。");
  }
}

export function parseSubmitStaffScheduleInput(
  value: unknown, idempotencyHeader: string | null,
): SubmitStaffScheduleInput {
  const parsed = submit.safeParse(value);
  if (!parsed.success) invalid("請完整填寫員工、時間、職務、場地、車輛、人數與版本依據。");
  validateDuration(parsed.data.starts_at, parsed.data.ends_at);
  if (parsed.data.planned_clients > 10_000) invalid("預計服務人數超出可接受範圍。");
  return {
    action: parsed.data.action, scheduleKey: parsed.data.schedule_key,
    previousVersionId: parsed.data.previous_version_id,
    expectedVersion: parsed.data.expected_version,
    expectedContentHash: parsed.data.expected_content_hash,
    staffMembershipId: parsed.data.staff_membership_id,
    startsAt: parsed.data.starts_at, endsAt: parsed.data.ends_at,
    roleText: parsed.data.role_text, serviceNeedText: parsed.data.service_need_text,
    facilityCode: parsed.data.facility_code, vehicleCode: parsed.data.vehicle_code,
    plannedClients: parsed.data.planned_clients,
    revisionReason: parsed.data.revision_reason,
    idempotencyKey: parseKey(idempotencyHeader),
  };
}

export function parseDecideStaffScheduleInput(
  value: unknown, idempotencyHeader: string | null,
  requiredDecision?: DecideStaffScheduleInput["decision"],
): DecideStaffScheduleInput {
  const parsed = decision.safeParse(value);
  if (!parsed.success || requiredDecision && parsed.data.decision !== requiredDecision) {
    invalid("請提供待審班表、完整預期版本、決定與理由。");
  }
  if (parsed.data.expected_conflict_count > 20 ||
    parsed.data.decision === "publish" && parsed.data.expected_conflict_count !== 0 ||
    parsed.data.decision === "override" && parsed.data.expected_conflict_count === 0) {
    invalid("審核決定與衝突數不一致。");
  }
  return {
    action: "decide", scheduleVersionId: parsed.data.schedule_version_id,
    expectedScheduleKey: parsed.data.expected_schedule_key,
    expectedVersion: parsed.data.expected_version,
    expectedContentHash: parsed.data.expected_content_hash,
    expectedConflictCount: parsed.data.expected_conflict_count,
    expectedRuleVersionId: parsed.data.expected_rule_version_id,
    decision: parsed.data.decision, reason: parsed.data.reason,
    idempotencyKey: parseKey(idempotencyHeader),
  };
}

export function parseSubmitStaffScheduleReceipt(
  value: unknown, input: SubmitStaffScheduleInput,
  expectedOrganizationId: string, expectedBranchId: string,
): SubmitStaffScheduleReceipt {
  const parsed = submitReceipt.safeParse(value);
  const expectedVersion = input.action === "create" ? 1 : input.expectedVersion + 1;
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId ||
    parsed.data.schedule_key !== input.scheduleKey ||
    parsed.data.schedule_version !== expectedVersion ||
    parsed.data.staff_membership_id !== input.staffMembershipId ||
    (parsed.data.conflict_count === 0) !==
      (parsed.data.schedule_status === "draft_ready") ||
    parsed.data.conflict_count > 20) uncertain(
    "班表草稿回執無法與送出內容核對；請保留相同操作鍵重試。",
  );
  return {
    organizationId: parsed.data.organization_id, branchId: parsed.data.branch_id,
    scheduleKey: parsed.data.schedule_key,
    scheduleVersionId: parsed.data.schedule_version_id,
    scheduleVersion: parsed.data.schedule_version,
    scheduleStatus: parsed.data.schedule_status,
    staffMembershipId: parsed.data.staff_membership_id,
    ruleVersionId: parsed.data.rule_version_id,
    conflictCount: parsed.data.conflict_count, contentHash: parsed.data.content_hash,
    committedAt: parsed.data.committed_at, replayed: parsed.data.replayed,
    persisted: true, demo: false,
  };
}

export function parseDecideStaffScheduleReceipt(
  value: unknown, input: DecideStaffScheduleInput,
  expectedOrganizationId: string, expectedBranchId: string,
): DecideStaffScheduleReceipt {
  const parsed = decisionReceipt.safeParse(value);
  const resultStatus = input.decision === "reject" ? "voided" : "published";
  const reviewMode = input.decision === "publish" ? "standard" :
    input.decision === "override" ? "override" : "rejected";
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId ||
    parsed.data.schedule_key !== input.expectedScheduleKey ||
    parsed.data.decided_version_id !== input.scheduleVersionId ||
    parsed.data.expected_version !== input.expectedVersion ||
    parsed.data.decision !== input.decision ||
    parsed.data.result_version !== input.expectedVersion + 1 ||
    parsed.data.result_status !== resultStatus || parsed.data.review_mode !== reviewMode ||
    parsed.data.conflict_count !== input.expectedConflictCount ||
    parsed.data.rule_version_id !== input.expectedRuleVersionId) uncertain(
    "班表審核回執無法與待審版本核對；請保留相同操作鍵重試。",
  );
  return {
    organizationId: parsed.data.organization_id, branchId: parsed.data.branch_id,
    scheduleKey: parsed.data.schedule_key,
    decidedVersionId: parsed.data.decided_version_id,
    expectedVersion: parsed.data.expected_version, decisionId: parsed.data.decision_id,
    decision: parsed.data.decision, resultVersionId: parsed.data.result_version_id,
    resultVersion: parsed.data.result_version, resultStatus: parsed.data.result_status,
    reviewMode: parsed.data.review_mode, conflictCount: parsed.data.conflict_count,
    ruleVersionId: parsed.data.rule_version_id, contentHash: parsed.data.content_hash,
    decidedAt: parsed.data.decided_at, replayed: parsed.data.replayed,
    persisted: true, demo: false,
  };
}

function parseEnvelope(value: unknown) {
  const parsed = envelope.safeParse(value);
  if (!parsed.success) uncertain("伺服器回應缺少可核對的 request_id 或狀態。");
  return parsed.data.data;
}
function checkStatus(replayed: boolean, status: number) {
  if (status !== (replayed ? 200 : 201)) uncertain("HTTP 狀態與操作回執不一致。");
}

export function parseSubmitStaffScheduleApiEnvelope(
  value: unknown, input: SubmitStaffScheduleInput,
  expectedOrganizationId: string, expectedBranchId: string, httpStatus: number,
) {
  const parsed = z.object({ receipt: apiSubmitReceipt, persisted: z.literal(true),
    demo: z.literal(false) }).strict().safeParse(parseEnvelope(value));
  if (!parsed.success) uncertain("班表草稿回應內容不完整。");
  const item = parsed.data.receipt;
  const receipt = parseSubmitStaffScheduleReceipt({
    organization_id: item.organizationId, branch_id: item.branchId,
    schedule_key: item.scheduleKey, schedule_version_id: item.scheduleVersionId,
    schedule_version: item.scheduleVersion, schedule_status: item.scheduleStatus,
    staff_membership_id: item.staffMembershipId, rule_version_id: item.ruleVersionId,
    conflict_count: item.conflictCount, content_hash: item.contentHash,
    committed_at: item.committedAt, replayed: item.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  checkStatus(receipt.replayed, httpStatus); return receipt;
}

export function parseDecideStaffScheduleApiEnvelope(
  value: unknown, input: DecideStaffScheduleInput,
  expectedOrganizationId: string, expectedBranchId: string, httpStatus: number,
) {
  const parsed = z.object({ receipt: apiDecisionReceipt, persisted: z.literal(true),
    demo: z.literal(false) }).strict().safeParse(parseEnvelope(value));
  if (!parsed.success) uncertain("班表審核回應內容不完整。");
  const item = parsed.data.receipt;
  const receipt = parseDecideStaffScheduleReceipt({
    organization_id: item.organizationId, branch_id: item.branchId,
    schedule_key: item.scheduleKey, decided_version_id: item.decidedVersionId,
    expected_version: item.expectedVersion, decision_id: item.decisionId,
    decision: item.decision, result_version_id: item.resultVersionId,
    result_version: item.resultVersion, result_status: item.resultStatus,
    review_mode: item.reviewMode, conflict_count: item.conflictCount,
    rule_version_id: item.ruleVersionId, content_hash: item.contentHash,
    decided_at: item.decidedAt, replayed: item.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  checkStatus(receipt.replayed, httpStatus); return receipt;
}
