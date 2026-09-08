import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
  "invalid timestamp",
).transform((value) => new Date(value).toISOString());
const safeText = z.string().trim().min(1).max(500).refine(
  (value) => !/[\u0000-\u001F\u007F]/u.test(value),
  "control characters are not allowed",
);
const serviceCode = z.string().regex(/^[A-Z0-9][A-Z0-9._/-]{0,39}$/u);

const baseEvent = {
  id: uuid,
  clientId: uuid,
  serviceCode,
  status: z.literal("completed"),
  startedAt: timestamp,
  endedAt: timestamp,
  signaturePurpose: z.literal("完成服務與執行證據簽署"),
};

const demoData = z.object({
  serviceEvent: z.object({
    ...baseEvent,
    signed: z.literal(true),
    signatureReauthChallengeId: z.null(),
  }).strict(),
  replayed: z.literal(false),
  persisted: z.literal(false),
  demo: z.literal(true),
}).strict();

const persistedData = z.object({
  serviceEvent: z.object({
    ...baseEvent,
    authorizedCarePlanId: uuid,
    clientServicePlanId: uuid,
    signedAt: timestamp,
    signedBy: uuid,
    signatureReauthChallengeId: uuid,
  }).strict(),
  operationId: uuid,
  replayed: z.boolean(),
  persisted: z.literal(true),
  demo: z.literal(false),
}).strict();

const successEnvelope = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: z.discriminatedUnion("demo", [demoData, persistedData]),
  errors: z.array(z.never()).length(0),
}).strict();

const errorEnvelope = z.object({
  requestId: uuid,
  status: z.literal("error"),
  data: z.null(),
  errors: z.array(z.object({
    code: z.string().regex(/^[A-Z0-9_]{2,80}$/u),
    message: safeText,
    field: z.string().trim().min(1).max(120).optional(),
  }).strict()).min(1).max(20),
}).strict();

export type ServiceCompletionExpected = {
  clientId: string;
  serviceCode: string;
  startedAt: string;
  endedAt: string;
};

export class ServiceCompletionClientContractError extends Error {
  constructor() {
    super("服務完成回覆不完整；結果未知，請保留內容並以相同操作重試。");
    this.name = "ServiceCompletionClientContractError";
  }
}

export function parseServiceCompletionEnvelope(
  raw: unknown,
  httpStatus: number,
  expected: ServiceCompletionExpected,
) {
  const parsed = successEnvelope.safeParse(raw);
  const expectedClientId = uuid.safeParse(expected.clientId);
  const expectedServiceCode = serviceCode.safeParse(expected.serviceCode.toUpperCase());
  const expectedStartedAt = timestamp.safeParse(expected.startedAt);
  const expectedEndedAt = timestamp.safeParse(expected.endedAt);
  if (
    !parsed.success ||
    !expectedClientId.success ||
    !expectedServiceCode.success ||
    !expectedStartedAt.success ||
    !expectedEndedAt.success
  ) {
    throw new ServiceCompletionClientContractError();
  }

  const data = parsed.data.data;
  const event = data.serviceEvent;
  const expectedHttpStatus = data.demo || data.replayed ? 200 : 201;
  if (
    httpStatus !== expectedHttpStatus ||
    event.clientId !== expectedClientId.data ||
    event.serviceCode !== expectedServiceCode.data ||
    event.startedAt !== expectedStartedAt.data ||
    event.endedAt !== expectedEndedAt.data ||
    event.endedAt < event.startedAt
  ) {
    throw new ServiceCompletionClientContractError();
  }
  return parsed.data;
}

export function parseServiceCompletionError(raw: unknown) {
  const parsed = errorEnvelope.safeParse(raw);
  return parsed.success ? parsed.data.errors[0] : null;
}
