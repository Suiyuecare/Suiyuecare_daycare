import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { ATTENDANCE_EVENT_KINDS, type AttendanceEventKind } from "./attendance-constants";

const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const serviceDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const eventKind = z.enum(ATTENDANCE_EVENT_KINDS);
const source = z.enum(["staff", "staff_backfill"]);
const base = {
  requestId: uuid,
  status: z.literal("ok"),
  errors: z.array(z.never()).length(0),
};
const demoEnvelope = z.object({
  ...base,
  data: z.object({
    operation: z.object({
      clientId: uuid,
      eventKind,
      occurredAt: timestamp,
      source,
    }).strict(),
    replayed: z.literal(false),
    persisted: z.literal(false),
    demo: z.literal(true),
  }).strict(),
}).strict();
const persistedEnvelope = z.object({
  ...base,
  data: z.object({
    operation: z.object({
      id: uuid,
      attendanceId: uuid,
      clientId: uuid,
      eventKind,
      occurredAt: timestamp,
      serviceDate,
      status: z.enum(["present", "absent", "leave"]),
      checkedInAt: timestamp.nullable(),
      checkedOutAt: timestamp.nullable(),
      source,
    }).strict(),
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  }).strict(),
}).strict();
const successEnvelope = z.union([demoEnvelope, persistedEnvelope]);

export class AttendanceClientContractError extends Error {
  constructor() {
    super("出勤回覆不完整；結果未知，請保留內容並以相同操作重試。");
    this.name = "AttendanceClientContractError";
  }
}

export function parseAttendanceSuccess(
  raw: unknown,
  httpStatus: number,
  expected: { clientId: string; eventKind: AttendanceEventKind; occurredAt: string },
) {
  const parsed = successEnvelope.safeParse(raw);
  const clientId = uuid.safeParse(expected.clientId);
  const occurredAt = timestamp.safeParse(expected.occurredAt);
  if (!parsed.success || !clientId.success || !occurredAt.success) {
    throw new AttendanceClientContractError();
  }
  const data = parsed.data.data;
  const operation = data.operation;
  const expectedStatus = expected.eventKind === "absent"
    ? "absent"
    : expected.eventKind === "leave"
      ? "leave"
      : "present";
  const expectedHttpStatus = data.demo || data.replayed ? 200 : 201;
  if (
    httpStatus !== expectedHttpStatus ||
    operation.clientId !== clientId.data ||
    operation.eventKind !== expected.eventKind ||
    operation.occurredAt !== occurredAt.data
  ) {
    throw new AttendanceClientContractError();
  }
  if (!data.demo) {
    const persisted = data.operation;
    if (
      persisted.status !== expectedStatus ||
      (expected.eventKind === "check_in" &&
        (persisted.checkedInAt !== occurredAt.data || persisted.checkedOutAt !== null)) ||
      (expected.eventKind === "check_out" &&
        (persisted.checkedOutAt !== occurredAt.data || persisted.checkedInAt === null ||
          persisted.checkedInAt > persisted.checkedOutAt)) ||
      ((expected.eventKind === "absent" || expected.eventKind === "leave") &&
        (persisted.checkedInAt !== null || persisted.checkedOutAt !== null))
    ) {
      throw new AttendanceClientContractError();
    }
  }
  return parsed.data;
}
