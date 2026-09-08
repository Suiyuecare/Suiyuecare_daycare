import { z } from "zod";

import {
  CLIENT_LIFECYCLE_STATUSES,
  CLIENT_TRANSITION_KINDS,
  type ClientLifecycleStatus,
  type ClientTransitionKind,
} from "@/lib/clients/types";

const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const positiveVersion = z.number().int().positive().safe();
const safeText = z.string().trim().min(1).max(500).refine(
  (value) => !/[\u0000-\u001F\u007F]/u.test(value),
  "control characters are not allowed",
);

const transitionReceipt = z.object({
  transition: z.object({
    id: uuid,
    clientId: uuid,
    eventKind: z.enum(CLIENT_TRANSITION_KINDS),
    effectiveOn: calendarDate,
    fromStatus: z.enum(CLIENT_LIFECYCLE_STATUSES),
    toStatus: z.enum(CLIENT_LIFECYCLE_STATUSES),
    baseRowVersion: positiveVersion,
    resultingRowVersion: positiveVersion,
  }).strict(),
  replayed: z.boolean(),
  persisted: z.literal(true),
  demo: z.literal(false),
}).strict();

const successEnvelope = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: transitionReceipt,
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

const targetStatusByKind: Record<ClientTransitionKind, ClientLifecycleStatus> = {
  admit: "active",
  suspend: "suspended",
  resume: "active",
  transfer: "transferred",
  close: "closed",
  death: "deceased",
};

export type ClientTransitionExpected = {
  clientId: string;
  eventKind: ClientTransitionKind;
  effectiveOn: string;
  fromStatus: ClientLifecycleStatus;
  baseRowVersion: number;
};

export class ClientTransitionClientContractError extends Error {
  constructor() {
    super("個案異動回覆不完整；結果未知，請保留內容並以相同操作重試。");
    this.name = "ClientTransitionClientContractError";
  }
}

export function parseClientTransitionSuccess(
  raw: unknown,
  httpStatus: number,
  expected: ClientTransitionExpected,
) {
  const parsed = successEnvelope.safeParse(raw);
  const expectedClientId = uuid.safeParse(expected.clientId);
  const expectedDate = calendarDate.safeParse(expected.effectiveOn);
  const expectedVersion = positiveVersion.safeParse(expected.baseRowVersion);
  if (
    !parsed.success ||
    !expectedClientId.success ||
    !expectedDate.success ||
    !expectedVersion.success
  ) {
    throw new ClientTransitionClientContractError();
  }

  const receipt = parsed.data.data;
  const transition = receipt.transition;
  const expectedHttpStatus = receipt.replayed ? 200 : 201;
  if (
    httpStatus !== expectedHttpStatus ||
    transition.clientId !== expectedClientId.data ||
    transition.eventKind !== expected.eventKind ||
    transition.effectiveOn !== expectedDate.data ||
    transition.fromStatus !== expected.fromStatus ||
    transition.toStatus !== targetStatusByKind[expected.eventKind] ||
    transition.baseRowVersion !== expectedVersion.data ||
    transition.resultingRowVersion !== expectedVersion.data + 1
  ) {
    throw new ClientTransitionClientContractError();
  }
  return parsed.data;
}

export function parseClientTransitionError(raw: unknown) {
  const parsed = errorEnvelope.safeParse(raw);
  return parsed.success ? parsed.data.errors[0] : null;
}
