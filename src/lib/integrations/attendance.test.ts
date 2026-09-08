import { describe, expect, it } from "vitest";

import { IntegrationError } from "./errors";
import {
  isAttendanceBackfill,
  parseAttendanceEvent,
} from "./attendance";

const clientId = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-09-01T04:00:00.000Z");

function validInput() {
  return {
    client_id: clientId,
    event_kind: "check_in",
    occurred_at: "2026-09-01T11:50:00+08:00",
  };
}

describe("dedicated attendance event input", () => {
  it("normalizes a recent event with a UUID idempotency header", () => {
    expect(parseAttendanceEvent(validInput(), idempotencyKey, now)).toEqual({
      clientId,
      eventKind: "check_in",
      occurredAt: "2026-09-01T03:50:00.000Z",
      reason: null,
      idempotencyKey,
      isBackfill: false,
    });
  });

  it("classifies only events older than fifteen minutes as backfill", () => {
    expect(isAttendanceBackfill("2026-09-01T03:45:00.000Z", now)).toBe(false);
    expect(isAttendanceBackfill("2026-09-01T03:44:59.999Z", now)).toBe(true);
  });

  it("identifies backfill and trims its reason without breaking a later exact replay", () => {
    const backfill = {
      ...validInput(),
      occurred_at: "2026-09-01T10:00:00+08:00",
    };
    expect(parseAttendanceEvent(backfill, idempotencyKey, now)).toMatchObject({
      reason: null,
      isBackfill: true,
    });
    expect(
      parseAttendanceEvent(
        { ...backfill, reason: "  接送延遲後補登  " },
        idempotencyKey,
        now,
      ),
    ).toMatchObject({ reason: "接送延遲後補登", isBackfill: true });
  });

  it.each(["check_in", "check_out", "absent", "leave"])(
    "accepts the %s event kind",
    (eventKind) => {
      expect(
        parseAttendanceEvent(
          { ...validInput(), event_kind: eventKind },
          idempotencyKey,
          now,
        ).eventKind,
      ).toBe(eventKind);
    },
  );

  it("rejects unknown fields, non-UUID idempotency keys, and distant future events", () => {
    expect(() =>
      parseAttendanceEvent(
        { ...validInput(), organization_id: clientId },
        idempotencyKey,
        now,
      ),
    ).toThrowError(IntegrationError);
    expect(() =>
      parseAttendanceEvent(validInput(), "retry-token", now),
    ).toThrowError(
      expect.objectContaining<Partial<IntegrationError>>({
        code: "INVALID_UUID",
        field: "idempotency_key",
      }),
    );
    expect(() =>
      parseAttendanceEvent(
        { ...validInput(), occurred_at: "2026-09-01T12:06:00+08:00" },
        idempotencyKey,
        now,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<IntegrationError>>({
        code: "DATETIME_IN_FUTURE",
        field: "occurred_at",
      }),
    );
  });
});
