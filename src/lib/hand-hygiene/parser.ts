import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import type {
  HandHygieneCorrectionInput,
  HandHygieneCorrectionReceipt,
} from "./types";

export const HAND_HYGIENE_CORRECTION_MAX_BYTES = 12 * 1024;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const narrative = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const safeText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const sequence = z.number().int().nonnegative().safe();
const matchStatus = z.enum(["matched", "unmatched", "excluded"]);

const correctionSchema = z.object({
  action: z.literal("correct_match"),
  eventId: uuid,
  expectedCorrectionSequence: sequence,
  matchStatus,
  staffMembershipId: uuid.nullable(),
  reason: narrative(1_000),
}).strict().superRefine((value, context) => {
  if ((value.matchStatus === "matched") !== (value.staffMembershipId !== null)) {
    context.addIssue({
      code: "custom",
      path: ["staffMembershipId"],
      message: "matched status requires exactly one staff membership",
    });
  }
});

const databaseReceiptSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  operation_id: uuid,
  event_id: uuid,
  correction_id: uuid,
  correction_sequence: sequence.pipe(z.number().int().positive()),
  match_status: matchStatus,
  staff_membership_id: uuid.nullable(),
  corrected_at: timestamp,
  replayed: z.boolean(),
}).strict();

const apiSuccessSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: z.object({
    action: z.literal("correct_match"),
    organizationId: uuid,
    branchId: uuid,
    operationId: uuid,
    eventId: uuid,
    correctionId: uuid,
    correctionSequence: z.number().int().positive().safe(),
    matchStatus,
    staffMembershipId: uuid.nullable(),
    correctedAt: timestamp,
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  }).strict(),
  errors: z.tuple([]),
}).strict();

const errorEnvelopeSchema = z.object({
  requestId: uuid,
  status: z.literal("error"),
  data: z.null(),
  errors: z.array(z.object({
    code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,119}$/u),
    message: safeText(500),
    field: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/u).optional(),
  }).strict()).min(1).max(10),
}).strict();

function invalid(code: string, message: string, status = 400): never {
  throw new IntegrationError(code, message, status);
}

export function parseHandHygieneCorrectionInput(
  value: unknown,
  idempotencyKey: string | null,
): HandHygieneCorrectionInput {
  const parsed = correctionSchema.safeParse(value);
  const key = uuid.safeParse(idempotencyKey);
  if (!parsed.success || !key.success) invalid(
    "INVALID_HAND_HYGIENE_CORRECTION",
    "事件、目前修正序號、配對狀態、員工、理由或操作鍵未通過驗證。",
  );
  return { ...parsed.data, idempotencyKey: key.data };
}

export function parseHandHygieneDatabaseReceipt(
  value: unknown,
  input: HandHygieneCorrectionInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
): HandHygieneCorrectionReceipt {
  const parsed = databaseReceiptSchema.safeParse(value);
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
      parsed.data.branch_id !== expectedBranchId ||
      parsed.data.event_id !== input.eventId ||
      parsed.data.correction_sequence !== input.expectedCorrectionSequence + 1 ||
      parsed.data.match_status !== input.matchStatus ||
      parsed.data.staff_membership_id !== input.staffMembershipId) invalid(
    "HAND_HYGIENE_RECEIPT_INVALID",
    "資料庫未回傳可與本次洗手事件修正逐項核對的完成憑證。",
    409,
  );
  return {
    action: "correct_match",
    operationId: parsed.data.operation_id,
    eventId: parsed.data.event_id,
    correctionId: parsed.data.correction_id,
    correctionSequence: parsed.data.correction_sequence,
    matchStatus: parsed.data.match_status,
    staffMembershipId: parsed.data.staff_membership_id,
    correctedAt: parsed.data.corrected_at,
    replayed: parsed.data.replayed,
    persisted: true,
    demo: false,
  };
}

export function parseHandHygieneApiSuccess(
  value: unknown,
  input: HandHygieneCorrectionInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
  httpStatus: number,
) {
  const parsed = apiSuccessSchema.safeParse(value);
  if (!parsed.success || parsed.data.data.organizationId !== expectedOrganizationId ||
      parsed.data.data.branchId !== expectedBranchId ||
      parsed.data.data.eventId !== input.eventId ||
      parsed.data.data.correctionSequence !== input.expectedCorrectionSequence + 1 ||
      parsed.data.data.matchStatus !== input.matchStatus ||
      parsed.data.data.staffMembershipId !== input.staffMembershipId ||
      httpStatus !== (parsed.data.data.replayed ? 200 : 201)) {
    throw new Error("MISMATCHED_HAND_HYGIENE_SUCCESS");
  }
  return parsed.data;
}

export function parseHandHygieneApiError(value: unknown) {
  const parsed = errorEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
