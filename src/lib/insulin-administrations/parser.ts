import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  INSULIN_ACTIONS,
  type InsulinMutationInput,
  type InsulinOperationResult,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const decimal = z.string().trim().regex(/^(?:[1-9][0-9]{0,7}|0\.[0-9]{0,3}[1-9]|[1-9][0-9]{0,7}\.[0-9]{0,3}[1-9])$/u);
const safeText = (min: number, max: number) => z.string().trim().min(min).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);
const positive = count.pipe(z.number().int().positive().max(100_000));

const authorizeSchema = z.object({
  action: z.literal("authorize_late"),
  medicationPlanId: uuid,
  scheduledFor: timestamp,
  lateReason: safeText(2, 1_000),
}).strict();
const executeSchema = z.object({
  action: z.literal("execute"),
  administrationKey: uuid.nullable(),
  previousEventId: uuid.nullable(),
  expectedSequence: z.union([z.literal(0), z.literal(1)]),
  medicationPlanId: uuid,
  scheduledFor: timestamp,
  doseText: decimal,
  doseUnit: safeText(1, 32),
  siteCode: z.string().trim().transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/u)),
  siteText: safeText(2, 120),
}).strict();
const reviewSchema = z.object({
  action: z.literal("review"),
  administrationKey: uuid,
  previousEventId: uuid,
  expectedSequence: z.number().int().positive().max(100_000),
}).strict();

const databaseReceiptSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  operation_id: uuid,
  operation_kind: z.enum(INSULIN_ACTIONS),
  administration_key: uuid,
  event_id: uuid,
  event_sequence: positive,
  previous_event_id: uuid.nullable(),
  state: z.enum(["late_authorized", "pending_review", "completed"]),
  medication_plan_id: uuid,
  governance_version_id: uuid,
  scheduled_for: timestamp,
  executed_at: timestamp.nullable(),
  reviewed_at: timestamp.nullable(),
  content_hash: hash,
  qualification_status: z.literal("published"),
  dose_rule_status: z.literal("published"),
  late_entry_rule_status: z.literal("published"),
  completion_status: z.enum(["pending_independent_review", "completed"]),
  offline_status: z.literal("not_configured"),
  replayed: z.boolean(),
  committed_at: timestamp,
}).strict();

const apiDataSchema = z.object({
  organizationId: uuid,
  branchId: uuid,
  operationId: uuid,
  operationKind: z.enum(INSULIN_ACTIONS),
  administrationKey: uuid,
  eventId: uuid,
  eventSequence: positive,
  previousEventId: uuid.nullable(),
  state: z.enum(["late_authorized", "pending_review", "completed"]),
  medicationPlanId: uuid,
  governanceVersionId: uuid,
  scheduledFor: timestamp,
  executedAt: timestamp.nullable(),
  reviewedAt: timestamp.nullable(),
  contentHash: hash,
  qualificationStatus: z.literal("published"),
  doseRuleStatus: z.literal("published"),
  lateEntryRuleStatus: z.literal("published"),
  completionStatus: z.enum(["pending_independent_review", "completed"]),
  offlineStatus: z.literal("not_configured"),
  committedAt: timestamp,
  replayed: z.boolean(),
  persisted: z.literal(true),
  demo: z.literal(false),
}).strict();
const successSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  errors: z.tuple([]),
  data: apiDataSchema,
}).strict();
const errorSchema = z.object({
  requestId: uuid,
  status: z.literal("error"),
  data: z.null(),
  errors: z.array(z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,119}$/u),
    message: z.string().min(1).max(500)
      .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
    field: z.string().regex(/^[a-z][A-Za-z0-9_.-]{0,119}$/u).optional(),
  }).strict()).min(1).max(10),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError("INVALID_INSULIN_ADMINISTRATION", message, 400, field);
}

export function parseInsulinMutation(
  body: Record<string, unknown>, idempotencyKey: string | null,
): InsulinMutationInput {
  const parsedKey = uuid.safeParse(idempotencyKey);
  if (!parsedKey.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  if (body.action === "authorize_late") {
    const parsed = authorizeSchema.safeParse(body);
    if (!parsed.success) invalid("補登授權內容、時點或理由未通過驗證。");
    return {
      ...parsed.data,
      administrationKey: null,
      previousEventId: null,
      expectedSequence: 0,
      idempotencyKey: parsedKey.data,
    };
  }
  if (body.action === "execute") {
    const parsed = executeSchema.safeParse(body);
    if (!parsed.success) invalid("劑量、單位、部位、排程或版本鏈未通過驗證。");
    const chainIsPresent = parsed.data.administrationKey !== null &&
      parsed.data.previousEventId !== null && parsed.data.expectedSequence === 1;
    const chainIsAbsent = parsed.data.administrationKey === null &&
      parsed.data.previousEventId === null && parsed.data.expectedSequence === 0;
    if (!chainIsPresent && !chainIsAbsent) invalid(
      "逾時補登必須完整帶入主管授權版本鏈。", "expectedSequence",
    );
    return { ...parsed.data, idempotencyKey: parsedKey.data };
  }
  if (body.action === "review") {
    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) invalid("覆核版本鏈未通過驗證。");
    return { ...parsed.data, idempotencyKey: parsedKey.data };
  }
  invalid("不支援的胰島素施打操作。", "action");
}

export function parseInsulinDatabaseReceipt(value: unknown) {
  const parsed = databaseReceiptSchema.safeParse(value);
  if (!parsed.success) throw new IntegrationError(
    "INSULIN_RECEIPT_INVALID", "資料庫完成憑證不完整；畫面不會視為成功。", 502,
  );
  return parsed.data;
}

export function correlateInsulinReceipt(
  receipt: z.output<typeof databaseReceiptSchema>,
  input: InsulinMutationInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
) {
  const organization = uuid.safeParse(expectedOrganizationId);
  const branch = uuid.safeParse(expectedBranchId);
  const expectedState = input.action === "authorize_late" ? "late_authorized"
    : input.action === "execute" ? "pending_review" : "completed";
  const expectedSequence = input.action === "authorize_late" ? 1
    : input.action === "execute" ? input.expectedSequence + 1
      : input.expectedSequence + 1;
  const expectedPrevious = input.action === "authorize_late" ? null : input.previousEventId;
  const expectedCompletion = input.action === "review"
    ? "completed" : "pending_independent_review";
  const needsExecutedAt = input.action !== "authorize_late";
  const needsReviewedAt = input.action === "review";
  if (!organization.success || !branch.success ||
      receipt.organization_id !== organization.data || receipt.branch_id !== branch.data ||
      receipt.operation_kind !== input.action || receipt.state !== expectedState ||
      receipt.event_sequence !== expectedSequence ||
      receipt.previous_event_id !== expectedPrevious ||
      receipt.completion_status !== expectedCompletion ||
      (input.action !== "review" && (
        receipt.medication_plan_id !== input.medicationPlanId ||
        receipt.scheduled_for !== input.scheduledFor
      )) ||
      needsExecutedAt !== (receipt.executed_at !== null) ||
      needsReviewedAt !== (receipt.reviewed_at !== null) ||
      (receipt.reviewed_at !== null && receipt.executed_at !== null &&
        Date.parse(receipt.reviewed_at) < Date.parse(receipt.executed_at)) ||
      (receipt.executed_at !== null &&
        Date.parse(receipt.committed_at) < Date.parse(receipt.executed_at))) {
    throw new IntegrationError(
      "INSULIN_RECEIPT_INVALID",
      "資料庫完成憑證與本次胰島素請求不一致；畫面不會視為成功。", 502,
    );
  }
  return receipt;
}

export function parseInsulinApiSuccess(
  value: unknown,
  input: InsulinMutationInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
  httpStatus: number,
): { requestId: string; status: "ok"; errors: []; data: InsulinOperationResult } {
  const parsed = successSchema.safeParse(value);
  if (!parsed.success || httpStatus !== (parsed.data.data.replayed ? 200 : 201)) {
    throw new Error("INVALID_INSULIN_SUCCESS");
  }
  correlateInsulinReceipt({
    organization_id: parsed.data.data.organizationId,
    branch_id: parsed.data.data.branchId,
    operation_id: parsed.data.data.operationId,
    operation_kind: parsed.data.data.operationKind,
    administration_key: parsed.data.data.administrationKey,
    event_id: parsed.data.data.eventId,
    event_sequence: parsed.data.data.eventSequence,
    previous_event_id: parsed.data.data.previousEventId,
    state: parsed.data.data.state,
    medication_plan_id: parsed.data.data.medicationPlanId,
    governance_version_id: parsed.data.data.governanceVersionId,
    scheduled_for: parsed.data.data.scheduledFor,
    executed_at: parsed.data.data.executedAt,
    reviewed_at: parsed.data.data.reviewedAt,
    content_hash: parsed.data.data.contentHash,
    qualification_status: parsed.data.data.qualificationStatus,
    dose_rule_status: parsed.data.data.doseRuleStatus,
    late_entry_rule_status: parsed.data.data.lateEntryRuleStatus,
    completion_status: parsed.data.data.completionStatus,
    offline_status: parsed.data.data.offlineStatus,
    replayed: parsed.data.data.replayed,
    committed_at: parsed.data.data.committedAt,
  }, input, expectedOrganizationId, expectedBranchId);
  return parsed.data;
}

export function parseInsulinApiError(value: unknown) {
  const parsed = errorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
