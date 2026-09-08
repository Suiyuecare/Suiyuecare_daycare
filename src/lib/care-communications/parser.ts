import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import type {
  CareCommunicationCorrectionInput,
  CareCommunicationCreateInput,
  CareCommunicationWriteResult,
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
  sha256: z.string().regex(/^[a-f0-9]{64}$/iu)
    .transform((value) => value.toLowerCase()),
}).strict();

const createBodySchema = z.object({
  action: z.literal("create"),
  clientId: uuid,
  subject: safeText(200),
  body: safeText(10_000),
  occurredAt: timestamp,
  attachments: z.array(attachmentSchema).max(20),
}).strict();

const correctionBodySchema = z.object({
  action: z.literal("correct"),
  clientId: uuid,
  communicationKey: uuid,
  previousVersionId: uuid,
  expectedVersion: z.number().int().positive().max(1_000_000),
  subject: safeText(200),
  body: safeText(10_000),
  correctionReason: safeText(500).refine(
    (value) => value.length >= 2,
    "correction reason too short",
  ),
  attachments: z.array(attachmentSchema).max(20),
}).strict();

const databaseReceiptSchema = z.object({
  operation_id: uuid,
  operation_kind: z.enum(["create", "correct"]),
  communication_key: uuid,
  version_id: uuid,
  communication_version: count.pipe(z.number().int().positive().max(1_000_001)),
  previous_version_id: uuid.nullable(),
  record_kind: z.enum(["original", "correction"]),
  client_id: uuid,
  recipient_count: count.pipe(z.number().int().positive().max(20)),
  delivery_status: z.literal("queued"),
  read_status: z.literal("not_configured"),
  family_confirmation_status: z.literal("not_configured"),
  attachment_state: z.literal("none"),
  submitted_at: timestamp,
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

const apiSuccessSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: z.object({
    action: z.enum(["create", "correct"]),
    operationId: uuid,
    communicationKey: uuid,
    versionId: uuid,
    communicationVersion: z.number().int().positive().max(1_000_001),
    previousVersionId: uuid.nullable(),
    recordKind: z.enum(["original", "correction"]),
    clientId: uuid,
    recipientCount: z.number().int().positive().max(20),
    deliveryStatus: z.literal("queued"),
    readStatus: z.literal("not_configured"),
    familyConfirmationStatus: z.literal("not_configured"),
    attachmentState: z.literal("none"),
    submittedAt: timestamp,
    persisted: z.literal(true),
    demo: z.literal(false),
    replayed: z.boolean(),
  }).strict(),
  errors: z.tuple([]),
}).strict();

function invalid(code: string, message: string, status = 400): never {
  throw new IntegrationError(code, message, status);
}

function rejectAttachments(attachments: readonly unknown[]): void {
  if (attachments.length > 0) {
    invalid(
      "ATTACHMENT_PIPELINE_NOT_CONFIGURED",
      "可信附件上傳、雜湊與掃毒管線尚未設定；本次操作未完成。",
      503,
    );
  }
}

export function parseCareCommunicationCreate(
  body: unknown,
  idempotencyKey: string | null,
): CareCommunicationCreateInput {
  const parsedKey = uuid.safeParse(idempotencyKey);
  const parsed = createBodySchema.safeParse(body);
  if (!parsedKey.success || !parsed.success) {
    invalid(
      "INVALID_CARE_COMMUNICATION",
      "個案、訊息、發生時間、附件或操作鍵不符合規則。",
    );
  }
  rejectAttachments(parsed.data.attachments);
  return { ...parsed.data, idempotencyKey: parsedKey.data };
}

export function parseCareCommunicationCorrection(
  body: unknown,
  idempotencyKey: string | null,
): CareCommunicationCorrectionInput {
  const parsedKey = uuid.safeParse(idempotencyKey);
  const parsed = correctionBodySchema.safeParse(body);
  if (!parsedKey.success || !parsed.success) {
    invalid(
      "INVALID_CARE_COMMUNICATION_CORRECTION",
      "更正來源、版本、訊息、理由、附件或操作鍵不符合規則。",
    );
  }
  rejectAttachments(parsed.data.attachments);
  return { ...parsed.data, idempotencyKey: parsedKey.data };
}

type WriteInput = CareCommunicationCreateInput | CareCommunicationCorrectionInput;

export function parseCareCommunicationDatabaseReceipt(
  value: unknown,
  input: WriteInput,
) {
  const parsed = databaseReceiptSchema.safeParse(value);
  const expectedVersion = input.action === "create" ? 1 : input.expectedVersion + 1;
  const expectedPrevious = input.action === "create" ? null : input.previousVersionId;
  const expectedKind = input.action === "create" ? "original" : "correction";
  if (!parsed.success ||
      parsed.data.operation_kind !== input.action ||
      parsed.data.client_id !== input.clientId ||
      parsed.data.communication_version !== expectedVersion ||
      parsed.data.previous_version_id !== expectedPrevious ||
      parsed.data.record_kind !== expectedKind ||
      (input.action === "correct" &&
        parsed.data.communication_key !== input.communicationKey)) {
    invalid(
      "CARE_COMMUNICATION_RECEIPT_INVALID",
      "資料庫未回傳可核對的溝通紀錄完成憑證；畫面不會視為完成。",
      502,
    );
  }
  return parsed.data;
}

export function parseCareCommunicationApiSuccess(
  value: unknown,
  input: WriteInput,
): { requestId: string; data: CareCommunicationWriteResult } {
  const parsed = apiSuccessSchema.safeParse(value);
  const expectedVersion = input.action === "create" ? 1 : input.expectedVersion + 1;
  const expectedPrevious = input.action === "create" ? null : input.previousVersionId;
  const expectedKind = input.action === "create" ? "original" : "correction";
  if (!parsed.success ||
      parsed.data.data.action !== input.action ||
      parsed.data.data.clientId !== input.clientId ||
      parsed.data.data.communicationVersion !== expectedVersion ||
      parsed.data.data.previousVersionId !== expectedPrevious ||
      parsed.data.data.recordKind !== expectedKind ||
      (input.action === "correct" &&
        parsed.data.data.communicationKey !== input.communicationKey)) {
    throw new Error("MISMATCHED_CARE_COMMUNICATION_SUCCESS");
  }
  return parsed.data;
}

export function parseCareCommunicationApiError(value: unknown) {
  const parsed = errorEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
