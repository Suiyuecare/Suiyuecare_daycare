import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { isPlanMonth, planMonthDate } from "@/lib/individual-service-plans/date";
import {
  INDIVIDUAL_PLAN_PROGRESS,
  type IndividualPlanWriteInput,
  type IndividualPlanWriteResult,
} from "@/lib/individual-service-plans/types";

import { IntegrationError } from "./errors";

export const INDIVIDUAL_PLAN_MAX_BYTES = 64 * 1024;

const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
  "invalid timestamp",
).transform((value) => new Date(value).toISOString());
const safeMessage = z.string().trim().min(1).max(500).refine(
  (value) => !/[\u0000-\u001F\u007F]/u.test(value),
  "control characters are not allowed",
);

const bodySchema = z
  .object({
    client_id: z.uuid(),
    plan_month: z.string(),
    previous_plan_id: z.uuid().nullable(),
    correction_reason: z.string().trim().min(1).max(1_000).nullable(),
    items: z
      .array(
        z
          .object({
            goal: z.string().trim().min(1).max(500),
            activity: z.string().trim().min(1).max(1_000),
            frequency: z.string().trim().min(1).max(240),
            responsible_user_id: z.uuid(),
            progress_status: z.enum(INDIVIDUAL_PLAN_PROGRESS),
            progress_note: z.string().trim().min(1).max(1_000).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

const resultRowSchema = z
  .object({
    plan_id: z.uuid(),
    client_id: z.uuid(),
    plan_month: z.string(),
    plan_version: z.number().int().positive().safe(),
    previous_plan_id: z.uuid().nullable(),
    signed_at: timestamp,
    replayed: z.boolean(),
  })
  .strict();

const apiDataSchema = z
  .object({
    planId: z.uuid(),
    clientId: z.uuid(),
    planMonth: z.string().refine(isPlanMonth),
    planVersion: z.number().int().positive().safe(),
    previousPlanId: z.uuid().nullable(),
    signedAt: timestamp,
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  })
  .strict();

const apiEnvelopeSchema = z
  .object({
    requestId: z.uuid(),
    status: z.literal("ok"),
    data: z.unknown(),
    errors: z.array(z.never()).length(0),
  })
  .strict();

const errorEnvelopeSchema = z.object({
  requestId: z.uuid(),
  status: z.literal("error"),
  data: z.null(),
  errors: z.array(z.object({
    code: z.string().regex(/^[A-Z0-9_]{2,100}$/u),
    message: safeMessage,
    field: z.string().trim().min(1).max(160).optional(),
  }).strict()).min(1).max(20),
}).strict();

function fail(message: string): never {
  throw new IntegrationError("INDIVIDUAL_PLAN_RESULT_INVALID", message, 409);
}

export function parseIndividualPlanInput(
  value: unknown,
  idempotencyHeader: string | null,
): IndividualPlanWriteInput {
  const parsed = bodySchema.safeParse(value);
  const key = z.uuid().safeParse(idempotencyHeader);
  if (!parsed.success || !key.success || !isPlanMonth(parsed.data?.plan_month ?? "")) {
    throw new IntegrationError(
      "INVALID_INDIVIDUAL_PLAN",
      "請完整填寫月份、個案、目標、活動、頻率、負責人與進度。",
      400,
    );
  }
  const body = parsed.data;
  if ((body.previous_plan_id === null) !== (body.correction_reason === null)) {
    throw new IntegrationError(
      "INVALID_INDIVIDUAL_PLAN_VERSION",
      "第一版不可填更正理由；新版必須指定目前版本並填寫更正理由。",
      400,
    );
  }
  return {
    clientId: body.client_id.toLowerCase(),
    planMonth: body.plan_month,
    previousPlanId: body.previous_plan_id?.toLowerCase() ?? null,
    correctionReason: body.correction_reason,
    items: body.items.map((item) => ({
      goal: item.goal,
      activity: item.activity,
      frequency: item.frequency,
      responsibleUserId: item.responsible_user_id.toLowerCase(),
      progressStatus: item.progress_status,
      progressNote: item.progress_note,
    })),
    idempotencyKey: key.data.toLowerCase(),
  };
}

export function individualPlanDatabaseItems(input: IndividualPlanWriteInput) {
  return input.items.map((item) => ({
    goal: item.goal,
    activity: item.activity,
    frequency: item.frequency,
    responsible_user_id: item.responsibleUserId,
    progress_status: item.progressStatus,
    progress_note: item.progressNote,
  }));
}

function validateResult(
  value: z.infer<typeof resultRowSchema>,
  input: IndividualPlanWriteInput,
) {
  if (
    value.client_id.toLowerCase() !== input.clientId ||
    value.plan_month !== planMonthDate(input.planMonth) ||
    (value.previous_plan_id?.toLowerCase() ?? null) !== input.previousPlanId ||
    (input.previousPlanId === null ? value.plan_version !== 1 : value.plan_version < 2) ||
    !Number.isFinite(new Date(value.signed_at).getTime())
  ) {
    fail("服務計畫回傳與送出內容不一致；請保留內容與相同操作鍵重試。");
  }
}

export function parseIndividualPlanResult(
  value: unknown,
  input: IndividualPlanWriteInput,
): IndividualPlanWriteResult {
  if (!Array.isArray(value) || value.length !== 1) {
    fail("服務計畫未完整確認；請保留內容與相同操作鍵重試。");
  }
  const parsed = resultRowSchema.safeParse(value[0]);
  if (!parsed.success) fail("服務計畫回傳格式不完整；請保留內容與相同操作鍵重試。");
  validateResult(parsed.data, input);
  return {
    planId: parsed.data.plan_id.toLowerCase(),
    clientId: parsed.data.client_id.toLowerCase(),
    planMonth: input.planMonth,
    planVersion: parsed.data.plan_version,
    previousPlanId: parsed.data.previous_plan_id?.toLowerCase() ?? null,
    signedAt: new Date(parsed.data.signed_at).toISOString(),
    replayed: parsed.data.replayed,
    persisted: true,
    demo: false,
  };
}

export function parseIndividualPlanApiEnvelope(
  value: unknown,
  input: IndividualPlanWriteInput,
  httpStatus: number,
) {
  const envelope = apiEnvelopeSchema.safeParse(value);
  if (!envelope.success) fail("服務計畫 API 回應不完整；請保留內容與相同操作鍵重試。");
  const data = apiDataSchema.safeParse(envelope.data.data);
  if (!data.success) fail("服務計畫 API 結果不完整；請保留內容與相同操作鍵重試。");
  const row = data.data;
  validateResult(
    {
      plan_id: row.planId,
      client_id: row.clientId,
      plan_month: planMonthDate(row.planMonth),
      plan_version: row.planVersion,
      previous_plan_id: row.previousPlanId,
      signed_at: row.signedAt,
      replayed: row.replayed,
    },
    input,
  );
  if (httpStatus !== (row.replayed ? 200 : 201)) {
    fail("服務計畫 API HTTP 狀態與建立／重送結果不一致；請保留內容與相同操作鍵重試。");
  }
  return { requestId: envelope.data.requestId.toLowerCase(), data: row };
}

export function parseIndividualPlanResponseContext(value: unknown) {
  const error = errorEnvelopeSchema.safeParse(value);
  if (error.success) {
    return {
      requestId: error.data.requestId.toLowerCase(),
      message: error.data.errors[0]!.message,
    };
  }
  const success = apiEnvelopeSchema.safeParse(value);
  return success.success
    ? { requestId: success.data.requestId.toLowerCase(), message: null }
    : null;
}
