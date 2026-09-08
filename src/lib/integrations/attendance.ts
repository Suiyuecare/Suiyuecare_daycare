import { z } from "zod";

import { ATTENDANCE_EVENT_KINDS,
  type AttendanceEventKind } from "@/lib/core-care/attendance-constants";

import { IntegrationError } from "./errors";
import {
  assertIdempotencyKey,
  assertUuid,
  parseIsoDateTime,
} from "./security";

export { ATTENDANCE_EVENT_KINDS };
export type { AttendanceEventKind };

const attendanceEventSchema = z
  .object({
    client_id: z.uuid(),
    event_kind: z.enum(ATTENDANCE_EVENT_KINDS),
    occurred_at: z.string(),
    reason: z.string().trim().max(1_000).optional(),
  })
  .strict();

export interface AttendanceEventInput {
  clientId: string;
  eventKind: AttendanceEventKind;
  occurredAt: string;
  reason: string | null;
  idempotencyKey: string;
  isBackfill: boolean;
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1_000;

export function isAttendanceBackfill(occurredAt: string, now = new Date()) {
  return now.getTime() - new Date(occurredAt).getTime() > FIFTEEN_MINUTES_MS;
}

export function parseAttendanceEvent(
  value: unknown,
  headerIdempotencyKey?: string | null,
  now = new Date(),
): AttendanceEventInput {
  const parsed = attendanceEventSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IntegrationError(
      "INVALID_ATTENDANCE_EVENT",
      issue?.message || "出勤事件欄位格式錯誤。",
      400,
      issue?.path.length ? issue.path.join(".") : undefined,
    );
  }

  const idempotencyKey = assertUuid(
    assertIdempotencyKey(headerIdempotencyKey),
    "idempotency_key",
  );
  const occurredAt = parseIsoDateTime(
    parsed.data.occurred_at,
    "occurred_at",
    { max: new Date(now.getTime() + 5 * 60 * 1_000) },
  );
  const reason = parsed.data.reason?.trim() || null;
  const isBackfill = isAttendanceBackfill(occurredAt, now);

  return {
    clientId: parsed.data.client_id,
    eventKind: parsed.data.event_kind,
    occurredAt,
    reason,
    idempotencyKey,
    isBackfill,
  };
}
