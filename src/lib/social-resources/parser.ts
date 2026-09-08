import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  SOCIAL_RESOURCE_INFORMATION_STATES,
  SOCIAL_RESOURCE_STATUSES,
  SOCIAL_RESOURCE_VALIDITY_STATES,
  type CreateSocialResourceInput,
  type SocialResourceMutationInput,
  type SocialResourceOperationResult,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const nullableText = (max: number) =>
  z.union([z.string().trim().min(1).max(max), z.null()]);
const nullableDate = z.union([date, z.null()]);

const fieldShape = {
  referenceYear: z.number().int().min(2000).max(2200),
  name: z.string().trim().min(1).max(160),
  resourceType: z.string().trim().min(1).max(80),
  audienceState: z.enum(SOCIAL_RESOURCE_INFORMATION_STATES),
  audienceDetail: nullableText(500),
  eligibilityState: z.enum(SOCIAL_RESOURCE_INFORMATION_STATES),
  eligibilityDetail: nullableText(2000),
  contactState: z.enum(SOCIAL_RESOURCE_INFORMATION_STATES),
  contactDetail: nullableText(1000),
  validityState: z.enum(SOCIAL_RESOURCE_VALIDITY_STATES),
  validFrom: nullableDate,
  validUntil: nullableDate,
};

function validateFields(
  value: z.infer<z.ZodObject<typeof fieldShape>>,
  context: z.RefinementCtx,
) {
  const pairs = [
    ["audienceDetail", value.audienceState, value.audienceDetail],
    ["eligibilityDetail", value.eligibilityState, value.eligibilityDetail],
    ["contactDetail", value.contactState, value.contactDetail],
  ] as const;
  for (const [field, state, detail] of pairs) {
    if ((state === "provided") !== (detail !== null)) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: "explicit information state does not match detail",
      });
    }
  }
  const valid =
    (value.validityState === "date_range" &&
      value.validUntil !== null &&
      (value.validFrom === null || value.validUntil >= value.validFrom)) ||
    (value.validityState === "open_ended" &&
      value.validFrom !== null &&
      value.validUntil === null) ||
    (["not_applicable", "missing"].includes(value.validityState) &&
      value.validFrom === null &&
      value.validUntil === null);
  if (!valid) {
    context.addIssue({
      code: "custom",
      path: ["validityState"],
      message: "validity state does not match dates",
    });
  }
}

const createSchema = z.object({ action: z.literal("create") })
  .extend(fieldShape).strict().superRefine(validateFields);
const updateSchema = z.object({
  action: z.literal("update"),
  resourceId: uuid,
  expectedRowVersion: z.number().int().positive().safe(),
}).extend(fieldShape).strict().superRefine(validateFields);
const confirmSchema = z.object({
  action: z.literal("confirm"),
  resourceId: uuid,
  expectedRowVersion: z.number().int().positive().safe(),
}).strict();
const deactivateSchema = z.object({
  action: z.literal("deactivate"),
  resourceId: uuid,
  expectedRowVersion: z.number().int().positive().safe(),
  reason: z.string().trim().min(1).max(500),
}).strict();

const resultSchema = z.object({
  operation_id: uuid,
  resource_id: uuid,
  row_version: z.union([
    z.number().int().positive().safe(),
    z.string().regex(/^[1-9]\d*$/u).transform(Number)
      .pipe(z.number().int().positive().safe()),
  ]),
  status: z.enum(SOCIAL_RESOURCE_STATUSES),
  last_confirmed_on: date.nullable(),
  replayed: z.boolean(),
}).strict();

const apiSuccessSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: z.object({
    operationId: uuid,
    resourceId: uuid,
    rowVersion: z.number().int().positive().safe(),
    status: z.enum(SOCIAL_RESOURCE_STATUSES),
    lastConfirmedOn: date.nullable(),
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  }).strict(),
  errors: z.tuple([]),
}).strict();

const apiErrorSchema = z.object({
  requestId: uuid,
  status: z.literal("error"),
  data: z.null(),
  errors: z.array(z.object({
    code: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(500),
    field: z.string().trim().min(1).max(120).optional(),
  }).strict()).min(1).max(10),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError("INVALID_SOCIAL_RESOURCE", message, 400, field);
}

function parseIdempotencyKey(value: string | null) {
  const result = uuid.safeParse(value);
  if (!result.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  return result.data;
}

export function parseCreateSocialResource(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): CreateSocialResourceInput {
  const result = createSchema.safeParse(body);
  if (!result.success) invalid("資源欄位、資訊狀態或有效期間未通過驗證。");
  return { ...result.data, idempotencyKey: parseIdempotencyKey(idempotencyKey) };
}

export function parseSocialResourceMutation(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): SocialResourceMutationInput {
  const action = body.action;
  const schema = action === "update"
    ? updateSchema
    : action === "confirm"
      ? confirmSchema
      : action === "deactivate"
        ? deactivateSchema
        : null;
  if (!schema) invalid("不支援的社會資源操作。", "action");
  const result = schema.safeParse(body);
  if (!result.success) invalid("資源操作內容、版本或必要理由未通過驗證。");
  return { ...result.data, idempotencyKey: parseIdempotencyKey(idempotencyKey) } as SocialResourceMutationInput;
}

export function parseSocialResourceOperationResult(
  value: unknown,
): Omit<SocialResourceOperationResult, "persisted" | "demo"> {
  const result = resultSchema.safeParse(value);
  if (!result.success) {
    throw new IntegrationError(
      "SOCIAL_RESOURCE_RECEIPT_INVALID",
      "資料庫完成憑證格式不完整；操作結果不會被畫面當作成功。",
      502,
    );
  }
  return {
    operationId: result.data.operation_id,
    resourceId: result.data.resource_id,
    rowVersion: result.data.row_version,
    status: result.data.status,
    lastConfirmedOn: result.data.last_confirmed_on,
    replayed: result.data.replayed,
  };
}

export type SocialResourceActionExpectation = {
  action: "create" | "update" | "confirm" | "deactivate";
  resourceId?: string;
  expectedRowVersion?: number;
};

export function parseSocialResourceActionSuccess(
  value: unknown,
  expectation: SocialResourceActionExpectation,
) {
  const parsed = apiSuccessSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_SOCIAL_RESOURCE_SUCCESS");
  const data = parsed.data.data;
  if (
    (expectation.resourceId !== undefined && data.resourceId !== expectation.resourceId) ||
    (expectation.expectedRowVersion !== undefined &&
      data.rowVersion !== expectation.expectedRowVersion + 1) ||
    (expectation.action === "deactivate"
      ? data.status !== "inactive"
      : data.status !== "active") ||
    (expectation.action === "confirm" && data.lastConfirmedOn === null)
  ) throw new Error("MISMATCHED_SOCIAL_RESOURCE_SUCCESS");
  return parsed.data;
}

export function parseSocialResourceActionError(value: unknown) {
  const parsed = apiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
