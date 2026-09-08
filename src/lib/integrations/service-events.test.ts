import { describe, expect, it } from "vitest";

import { IntegrationError } from "./errors";
import { parseServiceEventCompletion } from "./service-events";

const clientId = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-09-01T04:00:00.000Z");

function validInput() {
  return {
    client_id: clientId,
    service_code: "ba01-1",
    started_at: "2026-09-01T10:00:00+08:00",
    ended_at: "2026-09-01T11:00:00+08:00",
    result: "  已依計畫完成  ",
    notes: "  個案配合穩定  ",
  };
}

describe("dedicated completed service-event input", () => {
  it("normalizes code, evidence, timestamps, and a UUID retry header", () => {
    expect(
      parseServiceEventCompletion(validInput(), idempotencyKey, now),
    ).toEqual({
      clientId,
      serviceCode: "BA01-1",
      startedAt: "2026-09-01T02:00:00.000Z",
      endedAt: "2026-09-01T03:00:00.000Z",
      result: "已依計畫完成",
      notes: "個案配合穩定",
      idempotencyKey,
    });
  });

  it("rejects caller-supplied scope, plans, signatures, and hashes", () => {
    for (const field of [
      "organization_id",
      "branch_id",
      "expected_organization_id",
      "expected_branch_id",
      "staff_user_id",
      "client_service_plan_id",
      "signed_at",
      "signed_by",
      "signature_reauth_challenge_id",
      "content_hash",
      "evidence",
    ]) {
      expect(() =>
        parseServiceEventCompletion(
          { ...validInput(), [field]: "not-trusted" },
          idempotencyKey,
          now,
        ),
      ).toThrowError(IntegrationError);
    }
  });

  it("rejects malformed codes, negative periods, and missing UUID replay keys", () => {
    expect(() =>
      parseServiceEventCompletion(
        { ...validInput(), service_code: "BA 01" },
        idempotencyKey,
        now,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<IntegrationError>>({
        code: "INVALID_SERVICE_CODE",
        field: "service_code",
      }),
    );
    expect(() =>
      parseServiceEventCompletion(
        {
          ...validInput(),
          started_at: "2026-09-01T11:00:00+08:00",
          ended_at: "2026-09-01T10:00:00+08:00",
        },
        idempotencyKey,
        now,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<IntegrationError>>({
        code: "INVALID_SERVICE_PERIOD",
        field: "ended_at",
      }),
    );
    expect(() =>
      parseServiceEventCompletion(validInput(), "retry-token", now),
    ).toThrowError(
      expect.objectContaining<Partial<IntegrationError>>({
        code: "INVALID_UUID",
        field: "idempotency_key",
      }),
    );
  });

  it("enforces new-write time and UTF-8 evidence boundaries", () => {
    expect(() =>
      parseServiceEventCompletion(
        {
          ...validInput(),
          started_at: "2026-08-31T11:59:59+08:00",
          ended_at: "2026-08-31T12:30:00+08:00",
        },
        idempotencyKey,
        now,
      ),
    ).toThrowError(/超過允許範圍/u);

    expect(
      parseServiceEventCompletion(
        {
          ...validInput(),
          started_at: "2026-08-31T11:59:59+08:00",
          ended_at: "2026-08-31T12:30:00+08:00",
        },
        idempotencyKey,
        now,
        { enforceTimeWindow: false },
      ).startedAt,
    ).toBe("2026-08-31T03:59:59.000Z");

    expect(() =>
      parseServiceEventCompletion(
        { ...validInput(), notes: "照".repeat(1_500) },
        idempotencyKey,
        now,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<IntegrationError>>({
        code: "SERVICE_EVIDENCE_TOO_LARGE",
        field: "notes",
      }),
    );
  });
});
