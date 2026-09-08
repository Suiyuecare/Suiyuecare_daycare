import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  INFECTION_ACTIONS,
  INFECTION_HANDLING_STATUSES,
  INFECTION_TYPE_STATES,
  type InfectionAction,
  type InfectionEventMutationInput,
  type InfectionEventOperationResult,
  type ReportInfectionEventInput,
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
const chainVersion = z.number().int().nonnegative().safe();

const reportSchema = z.object({
  action: z.literal("report"),
  clientId: uuid,
  occurredAt: timestamp,
  location: safeText(240),
  eventSummary: narrativeText(2000),
  infectionTypeState: z.enum(INFECTION_TYPE_STATES),
  infectionTypeText: nullableSafeText(240),
}).strict().superRefine((value, context) => {
  if ((value.infectionTypeState === "provided") !== (value.infectionTypeText !== null)) {
    context.addIssue({ code: "custom", path: ["infectionTypeText"], message: "type state mismatch" });
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

const clusterSchema = z.object({
  action: z.enum(["cluster_link", "cluster_unlink"]),
  clientId: uuid,
  incidentId: uuid,
  occurredAt: timestamp,
  clusterId: uuid.nullable(),
  clusterLabel: safeText(120),
  expectedChainVersion: chainVersion,
}).strict().superRefine((value, context) => {
  if (value.action === "cluster_unlink" && value.clusterId === null) {
    context.addIssue({ code: "custom", path: ["clusterId"], message: "unlink target required" });
  }
});

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
  operation_kind: z.enum(INFECTION_ACTIONS),
  chain_version: z.union([chainVersion, z.string().regex(/^\d+$/u).transform(Number).pipe(chainVersion)]),
  handling_status: z.enum(INFECTION_HANDLING_STATUSES),
  cluster_id: uuid.nullable(),
  cluster_label: nullableSafeText(120),
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict().superRefine((value, context) => {
  const clusterAction = value.operation_kind === "cluster_link" || value.operation_kind === "cluster_unlink";
  if (clusterAction !== (value.cluster_id !== null && value.cluster_label !== null)) {
    context.addIssue({ code: "custom", path: ["cluster_id"], message: "cluster receipt mismatch" });
  }
});

const dataSchema = z.object({
  operationId: uuid,
  incidentId: uuid,
  clientId: uuid,
  entryId: uuid.nullable(),
  operationKind: z.enum(INFECTION_ACTIONS),
  chainVersion,
  handlingStatus: z.enum(INFECTION_HANDLING_STATUSES),
  clusterId: uuid.nullable(),
  clusterLabel: nullableSafeText(120),
  committedAt: timestamp,
  replayed: z.boolean(),
  persisted: z.literal(true),
  demo: z.literal(false),
}).strict();

const apiSuccessSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: dataSchema,
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
  throw new IntegrationError("INVALID_INFECTION_EVENT", message, 400, field);
}

function parseKey(value: string | null) {
  const result = uuid.safeParse(value);
  if (!result.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  return result.data;
}

export function parseInfectionEventReport(body: Record<string, unknown>, key: string | null): ReportInfectionEventInput {
  const result = reportSchema.safeParse(body);
  if (!result.success) invalid("事件時間、個案、地點、描述或感染類型未通過驗證。");
  return { ...result.data, idempotencyKey: parseKey(key) };
}

export function parseInfectionEventMutation(body: Record<string, unknown>, key: string | null): InfectionEventMutationInput {
  const schema = body.action === "close" ? closeSchema
    : body.action === "treatment" || body.action === "follow_up" ? appendSchema
      : body.action === "cluster_link" || body.action === "cluster_unlink" ? clusterSchema : null;
  if (!schema) invalid("不支援的感染事件操作。", "action");
  const result = schema.safeParse(body);
  if (!result.success) invalid("時間軸內容、群聚目標、結案內容或鏈版本未通過驗證。");
  return { ...result.data, idempotencyKey: parseKey(key) } as InfectionEventMutationInput;
}

export function parseInfectionEventOperationResult(value: unknown): Omit<InfectionEventOperationResult, "persisted" | "demo"> {
  const result = resultSchema.safeParse(value);
  if (!result.success) throw new IntegrationError(
    "INFECTION_EVENT_RECEIPT_INVALID",
    "資料庫完成憑證格式不完整；畫面不會把操作當作成功。",
    502,
  );
  return {
    operationId: result.data.operation_id,
    incidentId: result.data.incident_id,
    clientId: result.data.client_id,
    entryId: result.data.entry_id,
    operationKind: result.data.operation_kind,
    chainVersion: result.data.chain_version,
    handlingStatus: result.data.handling_status,
    clusterId: result.data.cluster_id,
    clusterLabel: result.data.cluster_label,
    committedAt: result.data.committed_at,
    replayed: result.data.replayed,
  };
}

export type InfectionEventActionExpectation = {
  action: InfectionAction;
  clientId: string;
  incidentId?: string;
  expectedChainVersion?: number;
  clusterId?: string | null;
  clusterLabel?: string | null;
};

export function parseInfectionEventActionSuccess(value: unknown, expected: InfectionEventActionExpectation) {
  const parsed = apiSuccessSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_INFECTION_EVENT_SUCCESS");
  const data = parsed.data.data;
  const expectedStatus = expected.action === "report" ? "reported" : expected.action === "close" ? "closed" : "in_progress";
  const clusterAction = expected.action === "cluster_link" || expected.action === "cluster_unlink";
  if (
    data.operationKind !== expected.action || data.clientId !== expected.clientId ||
    (expected.incidentId !== undefined && data.incidentId !== expected.incidentId) ||
    (expected.expectedChainVersion !== undefined && data.chainVersion !== expected.expectedChainVersion + 1) ||
    data.handlingStatus !== expectedStatus ||
    (expected.action === "report" ? data.entryId !== null || data.chainVersion !== 0 : data.entryId === null) ||
    (clusterAction ?
      ((expected.action === "cluster_link" && expected.clusterId === null)
        ? data.clusterId === null || data.clusterLabel !== expected.clusterLabel
        : data.clusterId !== expected.clusterId || data.clusterLabel !== expected.clusterLabel)
      : data.clusterId !== null || data.clusterLabel !== null)
  ) throw new Error("MISMATCHED_INFECTION_EVENT_SUCCESS");
  return parsed.data;
}

export function parseInfectionEventActionError(value: unknown) {
  const parsed = apiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
