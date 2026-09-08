import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import type {
  ConsultantMessageCreateInput,
  ConsultantMessageCreateResult,
  ConsultantMessageReceiptInput,
  ConsultantMessageReceiptResult,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) =>
    isStrictOffsetDateTime(value) &&
    Number.isFinite(new Date(value).getTime()),
  "invalid timestamp",
).transform((value) => new Date(value).toISOString());
const safeText = (max: number) => z.string().trim().min(1).max(max).refine(
  (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
  "control character",
);
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().nonnegative().safe()),
]);

const attachmentSchema = z.object({
  reference: z.string().regex(
    /^trusted-upload:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
  ).transform((value) => value.toLowerCase()),
  sha256: z.string().regex(/^[a-f0-9]{64}$/iu).transform((value) => value.toLowerCase()),
}).strict();

const createBodySchema = z.object({
  action: z.literal("create"),
  subject: safeText(200),
  body: safeText(10_000),
  occurredAt: timestamp,
  recipientUserIds: z.array(uuid).min(1).max(100),
  attachments: z.array(attachmentSchema).max(20),
}).strict().superRefine((value, context) => {
  if (new Set(value.recipientUserIds).size !== value.recipientUserIds.length) {
    context.addIssue({
      code: "custom",
      path: ["recipientUserIds"],
      message: "duplicate recipient",
    });
  }
});

const receiptBodySchema = z.object({
  action: z.enum(["read", "confirm"]),
  messageId: uuid,
}).strict();

const createDatabaseReceiptSchema = z.object({
  operation_id: uuid,
  message_id: uuid,
  category: z.literal("consultant"),
  recipient_count: count.pipe(z.number().int().positive().max(100)),
  published_at: timestamp,
  replayed: z.boolean(),
}).strict();

const receiptDatabaseReceiptSchema = z.object({
  operation_id: uuid,
  message_id: uuid,
  category: z.literal("consultant"),
  action: z.enum(["read", "confirm"]),
  read_at: timestamp,
  confirmed_at: timestamp.nullable(),
  replayed: z.boolean(),
}).strict();

const errorEnvelopeSchema = z.object({
  requestId: uuid,
  status: z.literal("error"),
  data: z.null(),
  errors: z.array(z.object({
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(500),
    field: z.string().min(1).max(100).optional(),
  }).strict()).min(1).max(10),
}).strict();

const persistedSchema = {
  persisted: z.literal(true),
  demo: z.literal(false),
  replayed: z.boolean(),
};

const createApiSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: z.object({
    action: z.literal("create"),
    operationId: uuid,
    messageId: uuid,
    category: z.literal("consultant"),
    recipientCount: z.number().int().positive().max(100),
    publishedAt: timestamp,
    ...persistedSchema,
  }).strict(),
  errors: z.tuple([]),
}).strict();

const receiptApiSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: z.object({
    operationId: uuid,
    messageId: uuid,
    category: z.literal("consultant"),
    action: z.enum(["read", "confirm"]),
    readAt: timestamp,
    confirmedAt: timestamp.nullable(),
    ...persistedSchema,
  }).strict(),
  errors: z.tuple([]),
}).strict();

function invalid(code: string, message: string, status = 400): never {
  throw new IntegrationError(code, message, status);
}

export function parseConsultantMessageCreate(
  body: unknown,
  idempotencyKey: string | null,
): ConsultantMessageCreateInput {
  const parsedKey = uuid.safeParse(idempotencyKey);
  const parsed = createBodySchema.safeParse(body);
  if (!parsedKey.success || !parsed.success) {
    invalid(
      "INVALID_CONSULTANT_MESSAGE",
      "顧問訊息欄位、時間、收件者或操作鍵不符合規則。",
    );
  }
  if (parsed.data.attachments.length > 0) {
    invalid(
      "ATTACHMENT_PIPELINE_NOT_CONFIGURED",
      "可信附件上傳與掃描管線尚未設定；本次訊息未建立。",
      503,
    );
  }
  const recipientUserIds = [...parsed.data.recipientUserIds].sort();
  return {
    ...parsed.data,
    recipientUserIds,
    idempotencyKey: parsedKey.data,
  };
}

export function parseConsultantMessageReceipt(
  body: unknown,
  idempotencyKey: string | null,
): ConsultantMessageReceiptInput {
  const parsedKey = uuid.safeParse(idempotencyKey);
  const parsed = receiptBodySchema.safeParse(body);
  if (!parsedKey.success || !parsed.success) {
    invalid(
      "INVALID_CONSULTANT_MESSAGE_RECEIPT",
      "顧問訊息、回條動作或操作鍵不符合規則。",
    );
  }
  return { ...parsed.data, idempotencyKey: parsedKey.data };
}

export function parseConsultantMessageCreateDatabaseReceipt(
  value: unknown,
  input: ConsultantMessageCreateInput,
) {
  const parsed = createDatabaseReceiptSchema.safeParse(value);
  if (!parsed.success ||
      parsed.data.recipient_count !== input.recipientUserIds.length) {
    invalid(
      "CONSULTANT_MESSAGE_RECEIPT_INVALID",
      "資料庫未回傳可核對的顧問訊息完成憑證。",
      409,
    );
  }
  return parsed.data;
}

export function parseConsultantMessageReceiptDatabaseReceipt(
  value: unknown,
  input: ConsultantMessageReceiptInput,
) {
  const parsed = receiptDatabaseReceiptSchema.safeParse(value);
  if (!parsed.success ||
      parsed.data.message_id !== input.messageId ||
      parsed.data.action !== input.action ||
      (input.action === "read" && parsed.data.confirmed_at !== null) ||
      (input.action === "confirm" && parsed.data.confirmed_at === null)) {
    invalid(
      "CONSULTANT_MESSAGE_RECEIPT_INVALID",
      "資料庫未回傳可核對的已讀／確認完成憑證。",
      409,
    );
  }
  return parsed.data;
}

export function parseConsultantMessageCreateApiSuccess(
  value: unknown,
  input: ConsultantMessageCreateInput,
): { requestId: string; data: ConsultantMessageCreateResult } {
  const parsed = createApiSchema.safeParse(value);
  if (!parsed.success ||
      parsed.data.data.recipientCount !== input.recipientUserIds.length) {
    throw new Error("MISMATCHED_CONSULTANT_MESSAGE_SUCCESS");
  }
  return parsed.data;
}

export function parseConsultantMessageReceiptApiSuccess(
  value: unknown,
  input: ConsultantMessageReceiptInput,
): { requestId: string; data: ConsultantMessageReceiptResult } {
  const parsed = receiptApiSchema.safeParse(value);
  if (!parsed.success ||
      parsed.data.data.messageId !== input.messageId ||
      parsed.data.data.action !== input.action ||
      (input.action === "read" && parsed.data.data.confirmedAt !== null) ||
      (input.action === "confirm" && parsed.data.data.confirmedAt === null)) {
    throw new Error("MISMATCHED_CONSULTANT_MESSAGE_RECEIPT_SUCCESS");
  }
  return parsed.data;
}

export function parseConsultantMessageApiError(value: unknown) {
  const parsed = errorEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
