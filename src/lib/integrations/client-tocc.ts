import { z } from "zod";

import {
  calculateToccValidThrough,
  parseClientToccAssessmentFields,
  taipeiCalendarDate,
  toClientToccDatabaseItem,
} from "@/lib/client-tocc/validation";
import {
  CLIENT_TOCC_ACTION_STATUSES,
  CLIENT_TOCC_EVIDENCE_STATUSES,
  CLIENT_TOCC_RESULT_STATUSES,
  type ClientToccAssessmentFields,
  type ClientToccBatchItemError,
  type ClientToccBatchItemResult,
  type ClientToccSingleWriteResult,
} from "@/lib/client-tocc/types";

import { IntegrationError } from "./errors";

export const CLIENT_TOCC_SINGLE_MAX_BYTES = 32 * 1024;
export const CLIENT_TOCC_BATCH_MAX_BYTES = 256 * 1024;
export const CLIENT_TOCC_BATCH_MAX_ITEMS = 100;

export type ClientToccSingleInput = ClientToccAssessmentFields & {
  idempotencyKey: string;
};
export type ClientToccBatchItemInput = ClientToccAssessmentFields & {
  idempotencyKey: string;
};
export type ClientToccBatchInput = {
  idempotencyKey: string;
  items: readonly ClientToccBatchItemInput[];
};

const uuidSchema = z.uuid();
const batchBodySchema = z
  .object({
    items: z
      .array(z.unknown())
      .min(1, "批次至少需要一筆資料。")
      .max(CLIENT_TOCC_BATCH_MAX_ITEMS, "批次最多 100 筆資料。"),
  })
  .strict();

const singleResultSchema = z
  .object({
    assessment_id: z.uuid(),
    client_id: z.uuid(),
    assessment_version: z.number().int().positive().safe(),
    assessment_date: z.string(),
    valid_through: z.string(),
    result_status: z.enum(CLIENT_TOCC_RESULT_STATUSES),
    evidence_status: z.enum(CLIENT_TOCC_EVIDENCE_STATUSES),
    action_status: z.enum(CLIENT_TOCC_ACTION_STATUSES),
    replayed: z.boolean(),
  })
  .strict();

const batchErrorSchema = z
  .object({
    code: z.enum([
      "validation_failed",
      "forbidden",
      "idempotency_conflict",
      "retryable_conflict",
      "internal_error",
    ]),
    sqlstate: z.string().regex(/^[0-9A-Z]{5}$/u),
    retryable: z.boolean(),
  })
  .strict();

const batchResultSchema = z
  .object({
    item_index: z.number().int().positive().safe(),
    item_idempotency_key: z.uuid().nullable(),
    status: z.enum(["success", "failed"]),
    assessment_id: z.uuid().nullable(),
    assessment_version: z.number().int().positive().safe().nullable(),
    valid_through: z.string().nullable(),
    item_replayed: z.boolean(),
    batch_replayed: z.boolean(),
    error: batchErrorSchema.nullable(),
  })
  .strict();

const singleApiResultSchema = z
  .object({
    assessmentId: z.uuid(),
    clientId: z.uuid(),
    assessmentVersion: z.number().int().positive().safe(),
    assessmentDate: z.string(),
    validThrough: z.string(),
    resultStatus: z.enum(CLIENT_TOCC_RESULT_STATUSES),
    evidenceStatus: z.enum(CLIENT_TOCC_EVIDENCE_STATUSES),
    actionStatus: z.enum(CLIENT_TOCC_ACTION_STATUSES),
    source: z.literal("staff"),
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  })
  .strict();

const batchApiItemSchema = z
  .object({
    itemIndex: z.number().int().positive().safe(),
    itemIdempotencyKey: z.uuid().nullable(),
    status: z.enum(["success", "failed"]),
    assessmentId: z.uuid().nullable(),
    assessmentVersion: z.number().int().positive().safe().nullable(),
    validThrough: z.string().nullable(),
    itemReplayed: z.boolean(),
    batchReplayed: z.boolean(),
    error: batchErrorSchema.nullable(),
  })
  .strict();

const batchApiPayloadSchema = z
  .object({
    items: z.array(batchApiItemSchema),
    counts: z
      .object({
        total: z.number().int().nonnegative().safe(),
        success: z.number().int().nonnegative().safe(),
        failed: z.number().int().nonnegative().safe(),
      })
      .strict(),
    persisted: z.literal(true),
    demo: z.literal(false),
  })
  .strict();

const apiErrorSchema = z
  .object({
    code: z.string().regex(/^CLIENT_TOCC_ITEM_[A-Z_]+$/u),
    message: z.string().trim().min(1).max(300),
    field: z.string().regex(/^items\.\d+$/u),
  })
  .strict();

const browserErrorEnvelopeSchema = z.object({
  requestId: z.uuid(),
  status: z.literal("error"),
  data: z.null(),
  errors: z.array(z.object({
    code: z.string().regex(/^[A-Z0-9_]{2,100}$/u),
    message: z.string().trim().min(1).max(500).refine(
      (value) => !/[\u0000-\u001F\u007F]/u.test(value),
      "control characters are not allowed",
    ),
    field: z.string().trim().min(1).max(160).optional(),
  }).strict()).min(1).max(20),
}).strict();

const singleApiEnvelopeSchema = z
  .object({
    requestId: z.uuid(),
    status: z.literal("ok"),
    data: z.unknown(),
    errors: z.array(z.never()).length(0),
  })
  .strict();

const batchApiEnvelopeSchema = z
  .object({
    requestId: z.uuid(),
    status: z.enum(["ok", "partial"]),
    data: z.unknown(),
    errors: z.array(apiErrorSchema),
  })
  .strict();

function parseUuidKey(value: string | null, field: string) {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new IntegrationError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "請提供有效的 UUID 冪等鍵。",
      400,
      field,
    );
  }
  return parsed.data.toLowerCase();
}

export function parseClientToccSingleInput(
  value: unknown,
  headerIdempotencyKey: string | null,
  now = new Date(),
): ClientToccSingleInput {
  return {
    ...parseClientToccAssessmentFields(value, taipeiCalendarDate(now)),
    idempotencyKey: parseUuidKey(headerIdempotencyKey, "idempotency_key"),
  };
}

export function parseClientToccBatchInput(
  value: unknown,
  headerIdempotencyKey: string | null,
  now = new Date(),
): ClientToccBatchInput {
  const body = batchBodySchema.safeParse(value);
  if (!body.success) {
    const issue = body.error.issues[0];
    throw new IntegrationError(
      "INVALID_CLIENT_TOCC_BATCH",
      issue?.message || "TOCC 批次格式錯誤。",
      400,
      issue?.path.length ? issue.path.join(".") : undefined,
    );
  }
  const todayTaipei = taipeiCalendarDate(now);
  const itemKeys = new Set<string>();
  const items = body.data.items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new IntegrationError(
        "INVALID_CLIENT_TOCC_BATCH",
        "批次每一筆都必須是資料物件。",
        400,
        `items.${index}`,
      );
    }
    const { idempotency_key: rawItemKey, ...fields } = item as Record<
      string,
      unknown
    >;
    const idempotencyKey = parseUuidKey(
      typeof rawItemKey === "string" ? rawItemKey : null,
      `items.${index}.idempotency_key`,
    );
    if (itemKeys.has(idempotencyKey)) {
      throw new IntegrationError(
        "DUPLICATE_ITEM_IDEMPOTENCY_KEY",
        "批次中的每一筆必須使用不同 UUID 冪等鍵。",
        400,
        `items.${index}.idempotency_key`,
      );
    }
    itemKeys.add(idempotencyKey);
    try {
      return {
        ...parseClientToccAssessmentFields(fields, todayTaipei),
        idempotencyKey,
      };
    } catch (error) {
      if (error instanceof IntegrationError) {
        throw new IntegrationError(
          error.code,
          error.message,
          error.httpStatus,
          error.field
            ? `items.${index}.${error.field}`
            : `items.${index}`,
        );
      }
      throw error;
    }
  });
  return {
    idempotencyKey: parseUuidKey(headerIdempotencyKey, "idempotency_key"),
    items,
  };
}

export function clientToccBatchDatabaseItems(input: ClientToccBatchInput) {
  return input.items.map((item) =>
    toClientToccDatabaseItem(item, item.idempotencyKey),
  );
}

export function parseClientToccSingleResult(
  value: unknown,
  input: ClientToccSingleInput,
): ClientToccSingleWriteResult {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new IntegrationError(
      "CLIENT_TOCC_RESULT_INVALID",
      "TOCC 結果未完整確認；請保留內容並以相同冪等鍵重試。",
      409,
    );
  }
  const parsed = singleResultSchema.safeParse(value[0]);
  if (!parsed.success) {
    throw new IntegrationError(
      "CLIENT_TOCC_RESULT_INVALID",
      "TOCC 結果未完整確認；請保留內容並以相同冪等鍵重試。",
      409,
    );
  }
  const row = parsed.data;
  if (
    row.client_id.toLowerCase() !== input.clientId ||
    row.assessment_date !== input.assessmentDate ||
    row.valid_through !== calculateToccValidThrough(input.assessmentDate) ||
    row.result_status !== input.resultStatus ||
    row.evidence_status !== input.evidenceStatus ||
    row.action_status !== input.actionStatus
  ) {
    throw new IntegrationError(
      "CLIENT_TOCC_RESULT_INVALID",
      "TOCC 結果與送出內容不一致；請保留內容並以相同冪等鍵重試。",
      409,
    );
  }
  return {
    assessmentId: row.assessment_id.toLowerCase(),
    clientId: row.client_id.toLowerCase(),
    assessmentVersion: row.assessment_version,
    assessmentDate: row.assessment_date,
    validThrough: row.valid_through,
    resultStatus: row.result_status,
    evidenceStatus: row.evidence_status,
    actionStatus: row.action_status,
    source: "staff",
    replayed: row.replayed,
    persisted: true,
    demo: false,
  };
}

function invalidBatchResult(message: string): never {
  throw new IntegrationError(
    "CLIENT_TOCC_BATCH_RESULT_INVALID",
    message,
    409,
  );
}

function isValidBatchError(error: ClientToccBatchItemError) {
  const expected =
    error.code === "validation_failed"
      ? ["22023", "22007", "22P02", "23514"]
      : error.code === "forbidden"
        ? ["42501"]
        : error.code === "idempotency_conflict"
          ? ["23505"]
          : error.code === "retryable_conflict"
            ? ["40001", "40P01", "55P03"]
            : [];
  return (
    (error.code === "internal_error" || expected.includes(error.sqlstate)) &&
    error.retryable === (error.code === "retryable_conflict")
  );
}

export function parseClientToccBatchResults(
  value: unknown,
  input: ClientToccBatchInput,
): readonly ClientToccBatchItemResult[] {
  if (!Array.isArray(value) || value.length !== input.items.length) {
    invalidBatchResult("TOCC 批次結果未完整確認；請保留內容並以相同批次鍵重試。");
  }
  const results = value.map((raw) => {
    const parsed = batchResultSchema.safeParse(raw);
    if (!parsed.success) {
      invalidBatchResult("TOCC 批次結果格式不完整；請保留內容並以相同批次鍵重試。");
    }
    const row = parsed.data;
    return {
      itemIndex: row.item_index,
      itemIdempotencyKey: row.item_idempotency_key?.toLowerCase() ?? null,
      status: row.status,
      assessmentId: row.assessment_id?.toLowerCase() ?? null,
      assessmentVersion: row.assessment_version,
      validThrough: row.valid_through,
      itemReplayed: row.item_replayed,
      batchReplayed: row.batch_replayed,
      error: row.error,
    } satisfies ClientToccBatchItemResult;
  });
  return validateClientToccBatchResultSet(results, input);
}

function validateClientToccBatchResultSet(
  results: readonly ClientToccBatchItemResult[],
  input: ClientToccBatchInput,
) {
  if (results.length !== input.items.length) {
    invalidBatchResult("TOCC 批次結果筆數不完整；請保留內容並以相同批次鍵重試。");
  }
  const seen = new Set<number>();
  let commonBatchReplay: boolean | null = null;
  for (const result of results) {
    const expected = input.items[result.itemIndex - 1];
    if (
      !expected ||
      seen.has(result.itemIndex) ||
      result.itemIdempotencyKey !== expected.idempotencyKey ||
      (commonBatchReplay !== null && commonBatchReplay !== result.batchReplayed)
    ) {
      invalidBatchResult("TOCC 批次項目對應不一致；請保留內容並以相同批次鍵重試。");
    }
    commonBatchReplay ??= result.batchReplayed;
    seen.add(result.itemIndex);
    const successIsValid =
      result.status === "success" &&
      result.assessmentId !== null &&
      result.assessmentVersion !== null &&
      result.validThrough === calculateToccValidThrough(expected.assessmentDate) &&
      result.error === null;
    const failedIsValid =
      result.status === "failed" &&
      result.assessmentId === null &&
      result.assessmentVersion === null &&
      result.validThrough === null &&
      result.itemReplayed === false &&
      result.error !== null &&
      isValidBatchError(result.error);
    if (!successIsValid && !failedIsValid) {
      invalidBatchResult("TOCC 批次項目結果不完整；請保留內容並以相同批次鍵重試。");
    }
  }
  if (seen.size !== input.items.length) {
    invalidBatchResult("TOCC 批次項目索引不完整；請保留內容並以相同批次鍵重試。");
  }
  return [...results].sort((left, right) => left.itemIndex - right.itemIndex);
}

export function parseClientToccSingleApiResult(
  value: unknown,
  input: ClientToccSingleInput,
) {
  const parsed = singleApiResultSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.clientId.toLowerCase() !== input.clientId ||
    parsed.data.assessmentDate !== input.assessmentDate ||
    parsed.data.validThrough !== calculateToccValidThrough(input.assessmentDate) ||
    parsed.data.resultStatus !== input.resultStatus ||
    parsed.data.evidenceStatus !== input.evidenceStatus ||
    parsed.data.actionStatus !== input.actionStatus
  ) {
    throw new IntegrationError(
      "CLIENT_TOCC_RESULT_INVALID",
      "TOCC API 結果未完整確認；請保留內容並以相同 UUID 鍵重試。",
      409,
    );
  }
  return parsed.data;
}

export function parseClientToccErrorEnvelope(value: unknown) {
  const parsed = browserErrorEnvelopeSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    requestId: parsed.data.requestId.toLowerCase(),
    error: parsed.data.errors[0],
  };
}

export function parseClientToccSingleApiEnvelope(
  value: unknown,
  input: ClientToccSingleInput,
  httpStatus: number,
) {
  const envelope = singleApiEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    throw new IntegrationError(
      "CLIENT_TOCC_RESULT_INVALID",
      "TOCC API 回應未完整確認；請保留內容並以相同 UUID 鍵重試。",
      409,
    );
  }
  const data = parseClientToccSingleApiResult(envelope.data.data, input);
  if (httpStatus !== (data.replayed ? 200 : 201)) {
    throw new IntegrationError(
      "CLIENT_TOCC_RESULT_INVALID",
      "TOCC API HTTP 狀態與建立／重送結果不一致；請保留內容並以相同 UUID 鍵重試。",
      409,
    );
  }
  return {
    requestId: envelope.data.requestId.toLowerCase(),
    data,
  };
}

export function parseClientToccBatchApiPayload(
  value: unknown,
  input: ClientToccBatchInput,
) {
  const parsed = batchApiPayloadSchema.safeParse(value);
  if (!parsed.success) {
    invalidBatchResult("TOCC 批次 API 結果格式不完整；請保留內容並以相同批次鍵重試。");
  }
  const items = validateClientToccBatchResultSet(parsed.data.items, input);
  const success = items.filter((item) => item.status === "success").length;
  const failed = items.length - success;
  if (
    parsed.data.counts.total !== items.length ||
    parsed.data.counts.success !== success ||
    parsed.data.counts.failed !== failed
  ) {
    invalidBatchResult("TOCC 批次 API 統計與逐筆結果不一致；請保留內容並以相同批次鍵重試。");
  }
  return { ...parsed.data, items };
}

export function parseClientToccBatchApiEnvelope(
  value: unknown,
  input: ClientToccBatchInput,
  httpStatus: number,
) {
  const envelope = batchApiEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    invalidBatchResult("TOCC 批次 API 回應未完整確認；請保留內容並以相同批次鍵重試。");
  }
  const data = parseClientToccBatchApiPayload(envelope.data.data, input);
  const failedIndices = new Set(
    data.items
      .filter((item) => item.status === "failed")
      .map((item) => item.itemIndex - 1),
  );
  const errorIndices = envelope.data.errors.map((error) =>
    Number(error.field.slice("items.".length)),
  );
  const errorsMatch =
    errorIndices.length === failedIndices.size &&
    new Set(errorIndices).size === errorIndices.length &&
    errorIndices.every((index) => failedIndices.has(index));
  if (
    (failedIndices.size === 0 &&
      (envelope.data.status !== "ok" || envelope.data.errors.length !== 0)) ||
    (failedIndices.size > 0 &&
      (envelope.data.status !== "partial" || !errorsMatch))
  ) {
    invalidBatchResult("TOCC 批次 API 狀態、錯誤與逐筆結果不一致；請保留內容並以相同批次鍵重試。");
  }
  const expectedHttpStatus = failedIndices.size > 0
    ? 207
    : data.items.every((item) => item.batchReplayed)
      ? 200
      : 201;
  if (httpStatus !== expectedHttpStatus) {
    invalidBatchResult("TOCC 批次 API HTTP 狀態與逐筆結果不一致；請保留內容並以相同批次鍵重試。");
  }
  return {
    requestId: envelope.data.requestId.toLowerCase(),
    status: envelope.data.status,
    data,
    errors: envelope.data.errors,
  };
}
