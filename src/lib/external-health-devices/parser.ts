import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import type {
  ExternalHealthActionInput,
  ExternalHealthActionReceipt,
  ExternalHealthDeviceStateInput,
} from "./types";

export const EXTERNAL_HEALTH_ACTION_MAX_BYTES = 16 * 1024;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const sequence = z.number().int().nonnegative().safe();
const narrative = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const safeText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const deviceAction = z.enum([
  "assign_device", "unassign_device", "disable_device", "enable_device",
]);
const matchStatus = z.enum(["matched", "unmatched", "excluded"]);
const operationalStatus = z.enum(["active", "disabled"]);

const deviceStateSchema = z.object({
  action: deviceAction,
  deviceId: uuid,
  expectedStateSequence: sequence,
  clientId: uuid.nullable(),
  reason: narrative(1_000),
}).strict().superRefine((value, context) => {
  if ((value.action === "assign_device") !== (value.clientId !== null)) {
    context.addIssue({ code: "custom", path: ["clientId"],
      message: "only assign_device accepts one client" });
  }
});

const measurementMatchSchema = z.object({
  action: z.literal("correct_measurement_match"),
  measurementId: uuid,
  expectedCorrectionSequence: sequence,
  matchStatus,
  clientId: uuid.nullable(),
  reason: narrative(1_000),
}).strict().superRefine((value, context) => {
  if ((value.matchStatus === "matched") !== (value.clientId !== null)) {
    context.addIssue({ code: "custom", path: ["clientId"],
      message: "matched status requires exactly one client" });
  }
});

const deviceReceiptSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  operation_id: uuid,
  action: deviceAction,
  device_id: uuid,
  state_event_id: uuid,
  state_sequence: sequence.pipe(z.number().int().positive()),
  operational_status: operationalStatus,
  assigned_client_id: uuid.nullable(),
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict();

const measurementReceiptSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  operation_id: uuid,
  action: z.literal("correct_measurement_match"),
  measurement_id: uuid,
  correction_id: uuid,
  correction_sequence: sequence.pipe(z.number().int().positive()),
  match_status: matchStatus,
  client_id: uuid.nullable(),
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict();

const receiptData = z.discriminatedUnion("receiptKind", [
  z.object({
    receiptKind: z.literal("device_state"), action: deviceAction,
    operationId: uuid, deviceId: uuid, stateEventId: uuid,
    stateSequence: sequence.pipe(z.number().int().positive()),
    operationalStatus, assignedClientId: uuid.nullable(),
    committedAt: timestamp, replayed: z.boolean(), persisted: z.literal(true),
    demo: z.literal(false), organizationId: uuid, branchId: uuid,
  }).strict(),
  z.object({
    receiptKind: z.literal("measurement_match"),
    action: z.literal("correct_measurement_match"), operationId: uuid,
    measurementId: uuid, correctionId: uuid,
    correctionSequence: sequence.pipe(z.number().int().positive()),
    matchStatus, clientId: uuid.nullable(), committedAt: timestamp,
    replayed: z.boolean(), persisted: z.literal(true), demo: z.literal(false),
    organizationId: uuid, branchId: uuid,
  }).strict(),
]);

const apiSuccessSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: receiptData,
  errors: z.tuple([]),
}).strict();
const errorEnvelopeSchema = z.object({
  requestId: uuid, status: z.literal("error"), data: z.null(),
  errors: z.array(z.object({
    code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,119}$/u),
    message: safeText(500),
    field: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/u).optional(),
  }).strict()).min(1).max(10),
}).strict();

function invalid(code: string, message: string, status = 400): never {
  throw new IntegrationError(code, message, status);
}

export function parseExternalHealthActionInput(
  value: unknown,
  idempotencyKey: string | null,
): ExternalHealthActionInput {
  const key = uuid.safeParse(idempotencyKey);
  if (!key.success || !value || typeof value !== "object" || !("action" in value)) {
    invalid("INVALID_EXTERNAL_HEALTH_ACTION",
      "設備、資料、目前版本、對象、理由或操作鍵未通過驗證。");
  }
  const action = (value as { action?: unknown }).action;
  const parsed = action === "correct_measurement_match"
    ? measurementMatchSchema.safeParse(value)
    : deviceStateSchema.safeParse(value);
  if (!parsed.success) invalid("INVALID_EXTERNAL_HEALTH_ACTION",
    "設備、資料、目前版本、對象、理由或操作鍵未通過驗證。");
  return { ...parsed.data, idempotencyKey: key.data } as ExternalHealthActionInput;
}

function expectedOperationalStatus(input: ExternalHealthDeviceStateInput) {
  return input.action === "disable_device" ? "disabled" : "active";
}

export function parseExternalHealthDatabaseReceipt(
  value: unknown,
  input: ExternalHealthActionInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
): ExternalHealthActionReceipt {
  if (input.action === "correct_measurement_match") {
    const parsed = measurementReceiptSchema.safeParse(value);
    if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
        parsed.data.branch_id !== expectedBranchId ||
        parsed.data.measurement_id !== input.measurementId ||
        parsed.data.correction_sequence !== input.expectedCorrectionSequence + 1 ||
        parsed.data.match_status !== input.matchStatus ||
        parsed.data.client_id !== input.clientId) invalid(
      "EXTERNAL_HEALTH_RECEIPT_INVALID",
      "資料庫未回傳可與本次量測配對逐項核對的完成憑證。", 409,
    );
    return {
      receiptKind: "measurement_match", action: input.action,
      operationId: parsed.data.operation_id,
      measurementId: parsed.data.measurement_id,
      correctionId: parsed.data.correction_id,
      correctionSequence: parsed.data.correction_sequence,
      matchStatus: parsed.data.match_status, clientId: parsed.data.client_id,
      committedAt: parsed.data.committed_at, replayed: parsed.data.replayed,
      persisted: true, demo: false,
    };
  }
  const parsed = deviceReceiptSchema.safeParse(value);
  const assignedMatches = input.action === "assign_device"
    ? parsed.success && parsed.data.assigned_client_id === input.clientId
    : input.action === "unassign_device"
      ? parsed.success && parsed.data.assigned_client_id === null
      : true;
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
      parsed.data.branch_id !== expectedBranchId || parsed.data.action !== input.action ||
      parsed.data.device_id !== input.deviceId ||
      parsed.data.state_sequence !== input.expectedStateSequence + 1 ||
      parsed.data.operational_status !== expectedOperationalStatus(input) ||
      !assignedMatches) invalid("EXTERNAL_HEALTH_RECEIPT_INVALID",
    "資料庫未回傳可與本次設備狀態逐項核對的完成憑證。", 409);
  return {
    receiptKind: "device_state", action: input.action,
    operationId: parsed.data.operation_id, deviceId: parsed.data.device_id,
    stateEventId: parsed.data.state_event_id,
    stateSequence: parsed.data.state_sequence,
    operationalStatus: parsed.data.operational_status,
    assignedClientId: parsed.data.assigned_client_id,
    committedAt: parsed.data.committed_at, replayed: parsed.data.replayed,
    persisted: true, demo: false,
  };
}

export function parseExternalHealthApiSuccess(
  value: unknown,
  input: ExternalHealthActionInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
  httpStatus: number,
) {
  const parsed = apiSuccessSchema.safeParse(value);
  if (!parsed.success || parsed.data.data.organizationId !== expectedOrganizationId ||
      parsed.data.data.branchId !== expectedBranchId ||
      parsed.data.data.action !== input.action ||
      httpStatus !== (parsed.data.data.replayed ? 200 : 201)) {
    throw new Error("MISMATCHED_EXTERNAL_HEALTH_SUCCESS");
  }
  const data = parsed.data.data;
  if (input.action === "correct_measurement_match") {
    if (data.receiptKind !== "measurement_match" ||
        data.measurementId !== input.measurementId ||
        data.correctionSequence !== input.expectedCorrectionSequence + 1 ||
        data.matchStatus !== input.matchStatus || data.clientId !== input.clientId) {
      throw new Error("MISMATCHED_EXTERNAL_HEALTH_SUCCESS");
    }
  } else if (data.receiptKind !== "device_state" ||
      data.deviceId !== input.deviceId ||
      data.stateSequence !== input.expectedStateSequence + 1 ||
      data.operationalStatus !== expectedOperationalStatus(input) ||
      (input.action === "assign_device" && data.assignedClientId !== input.clientId) ||
      (input.action === "unassign_device" && data.assignedClientId !== null)) {
    throw new Error("MISMATCHED_EXTERNAL_HEALTH_SUCCESS");
  }
  return parsed.data;
}

export function parseExternalHealthApiError(value: unknown) {
  const parsed = errorEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
