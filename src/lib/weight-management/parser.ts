import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import type { AcknowledgeWeightInput, CorrectWeightInput, RecordWeightInput, WeightMutationInput, WeightOperationResult } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)));
const decimalText = z.string().trim().regex(/^\d{1,6}(?:\.\d{1,2})?$/u).refine((value) => Number(value) > 0 && Number(value) <= 999999.99).transform((value) => Number(value).toFixed(2));
const narrative = z.string().trim().min(1).max(1000).refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value));
const source = z.string().trim().min(1).max(120).refine((value) => !/[\u0000-\u001F\u007F]/u.test(value));

const recordSchema = z.object({
  action: z.literal("record"), clientId: uuid, observedAt: timestamp,
  weightKg: decimalText, source,
}).strict();
const correctionBase = z.object({
  clientId: uuid, observationId: uuid,
  expectedCorrectionVersion: z.number().int().nonnegative().safe(),
  correctionReason: narrative,
});
const correctSchema = correctionBase.extend({
  action: z.literal("correct"), replacementWeightKg: decimalText,
}).strict();
const voidSchema = correctionBase.extend({
  action: z.literal("void"), replacementWeightKg: z.null(),
}).strict();
const acknowledgeSchema = z.object({
  action: z.literal("acknowledge"), clientId: uuid,
  currentObservationId: uuid, currentCorrectionVersion: z.number().int().nonnegative().safe(),
  priorObservationId: uuid, priorCorrectionVersion: z.number().int().nonnegative().safe(),
  ruleVersionId: uuid, acknowledgementNote: narrative,
}).strict();

const nullableInteger = z.union([z.number().int().safe(), z.string().regex(/^\d+$/u).transform(Number)]).pipe(z.number().int().nonnegative().safe()).nullable();
const resultSchema = z.object({
  operation_id: uuid,
  operation_kind: z.enum(["record", "correct", "void", "acknowledge"]),
  client_id: uuid,
  observation_id: uuid,
  correction_id: uuid.nullable(),
  correction_version: nullableInteger,
  prior_observation_id: uuid.nullable(),
  rule_version_id: uuid.nullable(),
  current_evidence_correction_version: nullableInteger,
  prior_evidence_correction_version: nullableInteger,
  acknowledgement_id: uuid.nullable(),
  committed_at: timestamp.transform((value) => new Date(value).toISOString()),
  replayed: z.boolean(),
}).strict();

const successSchema = z.object({
  requestId: uuid, status: z.literal("ok"), errors: z.tuple([]),
  data: z.object({
    operationId: uuid, operationKind: z.enum(["record", "correct", "void", "acknowledge"]),
    clientId: uuid, observationId: uuid, correctionId: uuid.nullable(),
    correctionVersion: nullableInteger, priorObservationId: uuid.nullable(),
    ruleVersionId: uuid.nullable(), currentEvidenceCorrectionVersion: nullableInteger,
    priorEvidenceCorrectionVersion: nullableInteger, acknowledgementId: uuid.nullable(),
    committedAt: timestamp.transform((value) => new Date(value).toISOString()), replayed: z.boolean(),
    persisted: z.literal(true), demo: z.literal(false),
  }).strict(),
}).strict();
const errorSchema = z.object({
  requestId: uuid, status: z.literal("error"), data: z.null(),
  errors: z.array(z.object({ code: z.string().min(1).max(120), message: z.string().min(1).max(500), field: z.string().min(1).max(120).optional() }).strict()).min(1).max(10),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError("INVALID_WEIGHT_OPERATION", message, 400, field);
}

function idempotency(value: string | null) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  return parsed.data;
}

export function parseRecordWeight(body: Record<string, unknown>, key: string | null): RecordWeightInput {
  const parsed = recordSchema.safeParse(body);
  if (!parsed.success) invalid("個案、量測時間、公斤值或來源未通過驗證。");
  return { ...parsed.data, idempotencyKey: idempotency(key) };
}

export function parseWeightMutation(body: Record<string, unknown>, key: string | null): WeightMutationInput {
  const schema = body.action === "correct" ? correctSchema : body.action === "void" ? voidSchema : body.action === "acknowledge" ? acknowledgeSchema : null;
  if (!schema) invalid("不支援的體重管理操作。", "action");
  const parsed = schema.safeParse(body);
  if (!parsed.success) invalid("更正版本、理由或警示證據未通過驗證。");
  return { ...parsed.data, idempotencyKey: idempotency(key) } as CorrectWeightInput | AcknowledgeWeightInput;
}

export function parseWeightOperationResult(value: unknown): Omit<WeightOperationResult, "persisted" | "demo"> {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw new IntegrationError("WEIGHT_RECEIPT_INVALID", "資料庫完成憑證格式不完整；畫面不會視為成功。", 502);
  const row = parsed.data;
  return {
    operationId: row.operation_id, operationKind: row.operation_kind,
    clientId: row.client_id, observationId: row.observation_id,
    correctionId: row.correction_id, correctionVersion: row.correction_version,
    priorObservationId: row.prior_observation_id, ruleVersionId: row.rule_version_id,
    currentEvidenceCorrectionVersion: row.current_evidence_correction_version,
    priorEvidenceCorrectionVersion: row.prior_evidence_correction_version,
    acknowledgementId: row.acknowledgement_id, committedAt: row.committed_at,
    replayed: row.replayed,
  };
}

export function parseWeightActionSuccess(value: unknown, input: RecordWeightInput | WeightMutationInput) {
  const parsed = successSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_WEIGHT_SUCCESS");
  const result = parsed.data.data;
  const expectedKind = input.action;
  if (result.operationKind !== expectedKind || result.clientId !== input.clientId ||
    (input.action === "record" && (result.correctionId !== null || result.acknowledgementId !== null)) ||
    ((input.action === "correct" || input.action === "void") && (result.observationId !== input.observationId || result.correctionVersion !== input.expectedCorrectionVersion + 1 || result.correctionId === null)) ||
    (input.action === "acknowledge" && (result.observationId !== input.currentObservationId || result.priorObservationId !== input.priorObservationId || result.ruleVersionId !== input.ruleVersionId || result.currentEvidenceCorrectionVersion !== input.currentCorrectionVersion || result.priorEvidenceCorrectionVersion !== input.priorCorrectionVersion || result.acknowledgementId === null))) throw new Error("MISMATCHED_WEIGHT_SUCCESS");
  return parsed.data;
}

export function parseWeightActionError(value: unknown) {
  const parsed = errorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
