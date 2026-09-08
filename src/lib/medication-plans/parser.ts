import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";
import { parseIsoDateTime } from "@/lib/integrations/datetime";

import type {
  ApproveMedicationPlanResult,
  CreateMedicationPlanDraftInput,
  CreateMedicationPlanDraftResult,
  MedicationPlanRecord,
  MedicationPlanVersionActionInput,
  StopMedicationPlanInput,
  StopMedicationPlanResult,
  SubmitMedicationPlanResult,
} from "./types";

const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;

const cleanText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !CONTROL_PATTERN.test(value));

const draftSchema = z
  .object({
    client_id: z.uuid(),
    previous_plan_id: z.uuid().nullable().optional(),
    medication_name: cleanText(200),
    dose: z.number().finite().positive().max(100_000),
    dose_unit: cleanText(32),
    route: cleanText(80),
    schedule_times: z
      .array(z.string().regex(TIME_PATTERN))
      .min(1)
      .max(24),
    high_risk: z.boolean(),
    effective_from: z.string(),
    effective_to: z.string().nullable().optional(),
  })
  .strict();

const versionActionSchema = z
  .object({
    medication_plan_id: z.uuid(),
    expected_row_version: z.number().int().positive().safe(),
  })
  .strict();

const stopSchema = z
  .object({
    medication_plan_id: z.uuid(),
    expected_row_version: z.number().int().positive().safe(),
    reason: cleanText(1_000),
  })
  .strict();

const safeInteger = z.union([
  z.number().int().positive().safe(),
  z
    .string()
    .regex(/^[1-9][0-9]*$/u)
    .transform((value, context) => {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) {
        context.addIssue({ code: "custom", message: "unsafe integer" });
        return z.NEVER;
      }
      return parsed;
    }),
]);

const baseResultFields = {
  plan_id: z.uuid(),
  client_id: z.uuid(),
  record_key: z.uuid(),
  version: safeInteger,
  row_version: safeInteger,
  replayed: z.boolean(),
};

const draftResultSchema = z
  .object({
    ...baseResultFields,
    workflow_state: z.literal("draft"),
    effective_from: z.string(),
  })
  .strict();

const submitResultSchema = z
  .object({
    ...baseResultFields,
    workflow_state: z.literal("submitted"),
    submitted_at: z.string(),
  })
  .strict();

const approveResultSchema = z
  .object({
    ...baseResultFields,
    workflow_state: z.literal("approved"),
    effective_from: z.string(),
    approved_at: z.string(),
    replacement_effective_at: z.string().nullable(),
  })
  .strict();

const stopResultSchema = z
  .object({
    plan_id: z.uuid(),
    client_id: z.uuid(),
    record_key: z.uuid(),
    version: safeInteger,
    row_version: safeInteger,
    lifecycle_state: z.literal("stopped"),
    stopped_at: z.string(),
    replayed: z.boolean(),
  })
  .strict();

const apiResultBase = {
  planId: z.uuid(),
  clientId: z.uuid(),
  recordKey: z.uuid(),
  version: safeInteger,
  rowVersion: safeInteger,
  replayed: z.boolean(),
  persisted: z.literal(true),
  demo: z.literal(false),
};

const apiDraftResultSchema = z
  .object({
    ...apiResultBase,
    workflowState: z.literal("draft"),
    effectiveFrom: z.string(),
  })
  .strict();

const apiSubmitResultSchema = z
  .object({
    ...apiResultBase,
    workflowState: z.literal("submitted"),
    submittedAt: z.string(),
  })
  .strict();

const apiApproveResultSchema = z
  .object({
    ...apiResultBase,
    workflowState: z.literal("approved"),
    effectiveFrom: z.string(),
    approvedAt: z.string(),
    replacementEffectiveAt: z.string().nullable(),
  })
  .strict();

const apiStopResultSchema = z
  .object({
    ...apiResultBase,
    lifecycleState: z.literal("stopped"),
    stoppedAt: z.string(),
  })
  .strict();

const apiErrorEnvelopeSchema = z
  .object({
    requestId: z.uuid(),
    status: z.literal("error"),
    data: z.null(),
    errors: z
      .array(
        z
          .object({
            code: cleanText(120),
            message: cleanText(1_000),
            field: cleanText(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict();

export type MedicationPlanActionExpectation =
  | {
      kind: "create";
      clientId: string;
      requestedEffectiveFrom: string;
    }
  | {
      kind: "revise";
      clientId: string;
      plan: MedicationPlanRecord;
      requestedEffectiveFrom: string;
    }
  | {
      kind: "submit" | "approve" | "stop";
      clientId: string;
      plan: MedicationPlanRecord;
    };

export type MedicationPlanActionSuccess = {
  requestId: string;
  data: {
    planId: string;
    clientId: string;
    recordKey: string;
    version: number;
    rowVersion: number;
    replayed: boolean;
    persisted: true;
    demo: false;
  };
};

function inputError(
  code: string,
  message: string,
  result: z.ZodSafeParseError<unknown>,
): never {
  const issue = result.error.issues[0];
  throw new IntegrationError(
    code,
    message,
    400,
    issue?.path.length ? issue.path.join(".") : undefined,
  );
}

function idempotencyKey(value: string | null) {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) {
    throw new IntegrationError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "請在 Idempotency-Key 標頭提供有效的 UUID。",
      400,
      "idempotency_key",
    );
  }
  return parsed.data.toLowerCase();
}

function preciseDose(value: number) {
  if (Math.abs(value * 10_000 - Math.round(value * 10_000)) > 1e-7) {
    throw new IntegrationError(
      "INVALID_MEDICATION_PLAN_DRAFT",
      "用藥劑量最多四位小數。",
      400,
      "dose",
    );
  }
  return value;
}

function resultError(): never {
  throw new IntegrationError(
    "MEDICATION_PLAN_RESULT_INVALID",
    "用藥計畫結果未完整確認；請保留內容並以相同冪等鍵重試。",
    409,
  );
}

function resultTimestamp(value: string) {
  try {
    return parseIsoDateTime(value, "result_timestamp");
  } catch {
    resultError();
  }
}

export function parseCreateMedicationPlanDraft(
  value: unknown,
  headerIdempotencyKey: string | null,
): CreateMedicationPlanDraftInput {
  const parsed = draftSchema.safeParse(value);
  if (!parsed.success) {
    inputError(
      "INVALID_MEDICATION_PLAN_DRAFT",
      "草稿只接受個案、前版、藥物、劑量、單位、途徑、時點、風險及生效期間。",
      parsed,
    );
  }
  const scheduleTimes = parsed.data.schedule_times.map((time) => time.trim());
  if (new Set(scheduleTimes).size !== scheduleTimes.length) {
    throw new IntegrationError(
      "INVALID_MEDICATION_PLAN_DRAFT",
      "同一用藥計畫不可有重複時點。",
      400,
      "schedule_times",
    );
  }
  const effectiveFrom = parseIsoDateTime(
    parsed.data.effective_from,
    "effective_from",
  );
  const effectiveTo = parsed.data.effective_to
    ? parseIsoDateTime(parsed.data.effective_to, "effective_to")
    : null;
  if (effectiveTo && effectiveTo <= effectiveFrom) {
    throw new IntegrationError(
      "INVALID_MEDICATION_PLAN_PERIOD",
      "結束時間必須晚於生效時間。",
      400,
      "effective_to",
    );
  }

  return {
    clientId: parsed.data.client_id.toLowerCase(),
    previousPlanId: parsed.data.previous_plan_id?.toLowerCase() ?? null,
    medicationName: parsed.data.medication_name,
    dose: preciseDose(parsed.data.dose),
    doseUnit: parsed.data.dose_unit,
    route: parsed.data.route,
    schedule: { times: scheduleTimes.sort() },
    highRisk: parsed.data.high_risk,
    effectiveFrom,
    effectiveTo,
    idempotencyKey: idempotencyKey(headerIdempotencyKey),
  };
}

export function parseMedicationPlanVersionAction(
  value: unknown,
  headerIdempotencyKey: string | null,
): MedicationPlanVersionActionInput {
  const parsed = versionActionSchema.safeParse(value);
  if (!parsed.success) {
    inputError(
      "INVALID_MEDICATION_PLAN_ACTION",
      "操作只接受用藥計畫識別碼及畫面上的精確資料版本。",
      parsed,
    );
  }
  return {
    medicationPlanId: parsed.data.medication_plan_id.toLowerCase(),
    expectedRowVersion: parsed.data.expected_row_version,
    idempotencyKey: idempotencyKey(headerIdempotencyKey),
  };
}

export function parseStopMedicationPlan(
  value: unknown,
  headerIdempotencyKey: string | null,
): StopMedicationPlanInput {
  const parsed = stopSchema.safeParse(value);
  if (!parsed.success) {
    inputError(
      "INVALID_MEDICATION_PLAN_STOP",
      "停藥只接受用藥計畫、精確資料版本及原因。",
      parsed,
    );
  }
  return {
    medicationPlanId: parsed.data.medication_plan_id.toLowerCase(),
    expectedRowVersion: parsed.data.expected_row_version,
    reason: parsed.data.reason,
    idempotencyKey: idempotencyKey(headerIdempotencyKey),
  };
}

export function parseCreateMedicationPlanDraftResult(
  value: unknown,
  expectedClientId: string,
  expectedEffectiveFrom: string,
): CreateMedicationPlanDraftResult {
  const parsed = draftResultSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.client_id.toLowerCase() !== expectedClientId.toLowerCase() ||
    resultTimestamp(parsed.data.effective_from) !==
      resultTimestamp(expectedEffectiveFrom) ||
    parsed.data.row_version !== 1
  ) {
    resultError();
  }
  return {
    planId: parsed.data.plan_id.toLowerCase(),
    clientId: parsed.data.client_id.toLowerCase(),
    recordKey: parsed.data.record_key.toLowerCase(),
    version: parsed.data.version,
    workflowState: parsed.data.workflow_state,
    rowVersion: parsed.data.row_version,
    effectiveFrom: resultTimestamp(parsed.data.effective_from),
    replayed: parsed.data.replayed,
  };
}

export function parseSubmitMedicationPlanResult(
  value: unknown,
  expectedPlanId: string,
  expectedRowVersion: number,
): SubmitMedicationPlanResult {
  const parsed = submitResultSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.plan_id.toLowerCase() !== expectedPlanId.toLowerCase() ||
    parsed.data.row_version !== expectedRowVersion + 1
  ) {
    resultError();
  }
  return {
    planId: parsed.data.plan_id.toLowerCase(),
    clientId: parsed.data.client_id.toLowerCase(),
    recordKey: parsed.data.record_key.toLowerCase(),
    version: parsed.data.version,
    workflowState: parsed.data.workflow_state,
    rowVersion: parsed.data.row_version,
    submittedAt: resultTimestamp(parsed.data.submitted_at),
    replayed: parsed.data.replayed,
  };
}

export function parseApproveMedicationPlanResult(
  value: unknown,
  expectedPlanId: string,
  expectedRowVersion: number,
): ApproveMedicationPlanResult {
  const parsed = approveResultSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.plan_id.toLowerCase() !== expectedPlanId.toLowerCase() ||
    parsed.data.row_version !== expectedRowVersion + 1
  ) {
    resultError();
  }
  return {
    planId: parsed.data.plan_id.toLowerCase(),
    clientId: parsed.data.client_id.toLowerCase(),
    recordKey: parsed.data.record_key.toLowerCase(),
    version: parsed.data.version,
    workflowState: parsed.data.workflow_state,
    rowVersion: parsed.data.row_version,
    effectiveFrom: resultTimestamp(parsed.data.effective_from),
    approvedAt: resultTimestamp(parsed.data.approved_at),
    replacementEffectiveAt: parsed.data.replacement_effective_at
      ? resultTimestamp(parsed.data.replacement_effective_at)
      : null,
    replayed: parsed.data.replayed,
  };
}

export function parseStopMedicationPlanResult(
  value: unknown,
  expectedPlanId: string,
  expectedRowVersion: number,
): StopMedicationPlanResult {
  const parsed = stopResultSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.plan_id.toLowerCase() !== expectedPlanId.toLowerCase() ||
    parsed.data.row_version !== expectedRowVersion
  ) {
    resultError();
  }
  return {
    planId: parsed.data.plan_id.toLowerCase(),
    clientId: parsed.data.client_id.toLowerCase(),
    recordKey: parsed.data.record_key.toLowerCase(),
    version: parsed.data.version,
    lifecycleState: parsed.data.lifecycle_state,
    rowVersion: parsed.data.row_version,
    stoppedAt: resultTimestamp(parsed.data.stopped_at),
    replayed: parsed.data.replayed,
  };
}

function actionResultError(): never {
  throw new Error("INVALID_MEDICATION_PLAN_ACTION_RESPONSE");
}

function normalizedUuid(value: string) {
  return value.toLowerCase();
}

function exactPlanResult(
  data: {
    planId: string;
    clientId: string;
    recordKey: string;
    version: number;
    rowVersion: number;
  },
  expectation: Extract<
    MedicationPlanActionExpectation,
    { kind: "revise" | "submit" | "approve" | "stop" }
  >,
) {
  const plan = expectation.plan;
  if (
    normalizedUuid(data.clientId) !== normalizedUuid(expectation.clientId) ||
    normalizedUuid(plan.clientId) !== normalizedUuid(expectation.clientId) ||
    normalizedUuid(data.recordKey) !== normalizedUuid(plan.recordKey)
  ) {
    actionResultError();
  }
  if (expectation.kind === "revise") {
    if (
      normalizedUuid(data.planId) === normalizedUuid(plan.id) ||
      data.version !== plan.version + 1 ||
      data.rowVersion !== 1
    ) {
      actionResultError();
    }
    return;
  }
  if (
    normalizedUuid(data.planId) !== normalizedUuid(plan.id) ||
    data.version !== plan.version ||
    (expectation.kind === "stop"
      ? data.rowVersion !== plan.rowVersion
      : data.rowVersion !== plan.rowVersion + 1)
  ) {
    actionResultError();
  }
}

export function parseMedicationPlanActionSuccess(
  value: unknown,
  expectation: MedicationPlanActionExpectation,
): MedicationPlanActionSuccess {
  const envelope = z
    .object({
      requestId: z.uuid(),
      status: z.literal("ok"),
      data: z.unknown(),
      errors: z.tuple([]),
    })
    .strict()
    .safeParse(value);
  if (!envelope.success) actionResultError();

  type CommonData = MedicationPlanActionSuccess["data"];
  let data: CommonData;

  if (expectation.kind === "create") {
    const parsed = apiDraftResultSchema.safeParse(envelope.data.data);
    if (!parsed.success) actionResultError();
    const effectiveFrom = resultTimestamp(parsed.data.effectiveFrom);
    if (
      normalizedUuid(parsed.data.clientId) !==
        normalizedUuid(expectation.clientId) ||
      parsed.data.version !== 1 ||
      parsed.data.rowVersion !== 1 ||
      effectiveFrom !== resultTimestamp(expectation.requestedEffectiveFrom)
    ) {
      actionResultError();
    }
    data = parsed.data;
  } else if (expectation.kind === "revise") {
    const parsed = apiDraftResultSchema.safeParse(envelope.data.data);
    if (!parsed.success) actionResultError();
    exactPlanResult(parsed.data, expectation);
    if (
      resultTimestamp(parsed.data.effectiveFrom) !==
      resultTimestamp(expectation.requestedEffectiveFrom)
    ) {
      actionResultError();
    }
    data = parsed.data;
  } else if (expectation.kind === "submit") {
    const parsed = apiSubmitResultSchema.safeParse(envelope.data.data);
    if (!parsed.success) actionResultError();
    exactPlanResult(parsed.data, expectation);
    resultTimestamp(parsed.data.submittedAt);
    data = parsed.data;
  } else if (expectation.kind === "approve") {
    const parsed = apiApproveResultSchema.safeParse(envelope.data.data);
    if (!parsed.success) actionResultError();
    exactPlanResult(parsed.data, expectation);
    const effectiveFrom = resultTimestamp(parsed.data.effectiveFrom);
    const approvedAt = resultTimestamp(parsed.data.approvedAt);
    const originalEffectiveFrom = resultTimestamp(expectation.plan.effectiveFrom);
    const submittedAt = expectation.plan.submittedAt
      ? resultTimestamp(expectation.plan.submittedAt)
      : null;
    const replacementEffectiveAt = parsed.data.replacementEffectiveAt
      ? resultTimestamp(parsed.data.replacementEffectiveAt)
      : null;
    if (
      submittedAt === null ||
      approvedAt < submittedAt ||
      effectiveFrom < originalEffectiveFrom ||
      (originalEffectiveFrom > approvedAt && effectiveFrom !== originalEffectiveFrom) ||
      (originalEffectiveFrom <= approvedAt && effectiveFrom !== approvedAt) ||
      (expectation.plan.previousVersionId === null
        ? replacementEffectiveAt !== null
        : replacementEffectiveAt !== effectiveFrom)
    ) {
      actionResultError();
    }
    data = parsed.data;
  } else {
    const parsed = apiStopResultSchema.safeParse(envelope.data.data);
    if (!parsed.success) actionResultError();
    exactPlanResult(parsed.data, expectation);
    const stoppedAt = resultTimestamp(parsed.data.stoppedAt);
    const approvedAt = expectation.plan.approvedAt
      ? resultTimestamp(expectation.plan.approvedAt)
      : null;
    if (approvedAt === null || stoppedAt < approvedAt) actionResultError();
    data = parsed.data;
  }

  const clientId = normalizedUuid(data.clientId);
  return {
    requestId: envelope.data.requestId.toLowerCase(),
    data: {
      planId: normalizedUuid(data.planId),
      clientId,
      recordKey: normalizedUuid(data.recordKey),
      version: data.version,
      rowVersion: data.rowVersion,
      replayed: data.replayed,
      persisted: data.persisted,
      demo: data.demo,
    },
  };
}

export function parseMedicationPlanActionError(value: unknown) {
  const parsed = apiErrorEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
