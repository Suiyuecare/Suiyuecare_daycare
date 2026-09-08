import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  FALL_HANDLING_STATUSES,
  FALL_INJURY_STATES,
  type FallEventMutationInput,
  type FallEventOperationResult,
  type ReportFallEventInput,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) && Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const safeText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const narrativeText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const nullableSafeText = (max: number) => z.union([safeText(max), z.null()]);
const nullableNarrativeText = (max: number) => z.union([narrativeText(max), z.null()]);
const chainVersion = z.number().int().nonnegative().safe();

const reportSchema = z.object({
  action: z.literal("report"),
  clientId: uuid,
  occurredAt: timestamp,
  location: safeText(240),
  eventSummary: narrativeText(2000),
  injuryDegreeState: z.enum(FALL_INJURY_STATES),
  injuryDegreeText: nullableSafeText(240),
  lateEntryReason: nullableNarrativeText(1000),
}).strict().superRefine((value, context) => {
  if ((value.injuryDegreeState === "provided") !== (value.injuryDegreeText !== null)) {
    context.addIssue({
      code: "custom",
      path: ["injuryDegreeText"],
      message: "injury information state does not match text",
    });
  }
});

const appendSchema = z.object({
  action: z.enum(["treatment", "follow_up"]),
  clientId: uuid,
  incidentId: uuid,
  occurredAt: timestamp,
  entryText: narrativeText(2000),
  expectedChainVersion: chainVersion,
}).strict();

const closeSchema = z.object({
  action: z.literal("close"),
  clientId: uuid,
  incidentId: uuid,
  occurredAt: timestamp,
  closureOutcome: narrativeText(2000),
  closureReason: narrativeText(1000),
  expectedChainVersion: chainVersion,
}).strict();

const resultSchema = z.object({
  operation_id: uuid,
  incident_id: uuid,
  client_id: uuid,
  entry_id: uuid.nullable(),
  chain_version: z.union([
    chainVersion,
    z.string().regex(/^\d+$/u).transform(Number).pipe(chainVersion),
  ]),
  handling_status: z.enum(FALL_HANDLING_STATUSES),
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict();

const apiSuccessSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: z.object({
    operationId: uuid,
    incidentId: uuid,
    clientId: uuid,
    entryId: uuid.nullable(),
    chainVersion,
    handlingStatus: z.enum(FALL_HANDLING_STATUSES),
    committedAt: timestamp,
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
  throw new IntegrationError("INVALID_FALL_EVENT", message, 400, field);
}

function parseIdempotencyKey(value: string | null) {
  const result = uuid.safeParse(value);
  if (!result.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  return result.data;
}

export function parseFallEventReport(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): ReportFallEventInput {
  const result = reportSchema.safeParse(body);
  if (!result.success) invalid("事件時間、個案、地點、內容或傷害資訊未通過驗證。");
  return { ...result.data, idempotencyKey: parseIdempotencyKey(idempotencyKey) };
}

export function parseFallEventMutation(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): FallEventMutationInput {
  const schema = body.action === "close"
    ? closeSchema
    : body.action === "treatment" || body.action === "follow_up"
      ? appendSchema
      : null;
  if (!schema) invalid("不支援的跌倒事件操作。", "action");
  const result = schema.safeParse(body);
  if (!result.success) invalid("時間軸內容、結案內容或鏈版本未通過驗證。");
  return { ...result.data, idempotencyKey: parseIdempotencyKey(idempotencyKey) } as FallEventMutationInput;
}

export function parseFallEventOperationResult(
  value: unknown,
): Omit<FallEventOperationResult, "persisted" | "demo"> {
  const result = resultSchema.safeParse(value);
  if (!result.success) {
    throw new IntegrationError(
      "FALL_EVENT_RECEIPT_INVALID",
      "資料庫完成憑證格式不完整；畫面不會把操作當作成功。",
      502,
    );
  }
  return {
    operationId: result.data.operation_id,
    incidentId: result.data.incident_id,
    clientId: result.data.client_id,
    entryId: result.data.entry_id,
    chainVersion: result.data.chain_version,
    handlingStatus: result.data.handling_status,
    committedAt: result.data.committed_at,
    replayed: result.data.replayed,
  };
}

export type FallEventActionExpectation = {
  action: "report" | "treatment" | "follow_up" | "close";
  clientId: string;
  incidentId?: string;
  expectedChainVersion?: number;
};

export function parseFallEventActionSuccess(
  value: unknown,
  expectation: FallEventActionExpectation,
) {
  const parsed = apiSuccessSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_FALL_EVENT_SUCCESS");
  const data = parsed.data.data;
  const expectedStatus = expectation.action === "report"
    ? "reported"
    : expectation.action === "close" ? "closed" : "in_progress";
  if (
    data.clientId !== expectation.clientId ||
    (expectation.incidentId !== undefined && data.incidentId !== expectation.incidentId) ||
    (expectation.expectedChainVersion !== undefined &&
      data.chainVersion !== expectation.expectedChainVersion + 1) ||
    data.handlingStatus !== expectedStatus ||
    (expectation.action === "report"
      ? data.entryId !== null || data.chainVersion !== 0
      : data.entryId === null)
  ) throw new Error("MISMATCHED_FALL_EVENT_SUCCESS");
  return parsed.data;
}

export function parseFallEventActionError(value: unknown) {
  const parsed = apiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
