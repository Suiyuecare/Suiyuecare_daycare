import { describe, expect, it } from "vitest";

import {
  parseMedicationActionError,
  parseMedicationActionSuccess,
  parseMedicationResponseRequestId,
} from "./action-response";

const requestId = "11111111-1111-4111-8111-111111111111";
const operationId = "22222222-2222-4222-8222-222222222222";
const administrationId = "33333333-3333-4333-8333-333333333333";
const occurredAt = "2026-09-01T03:30:00.000Z";

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    requestId,
    status: "ok",
    data: {
      operationId,
      medicationAdministrationId: administrationId,
      status: "administered",
      occurredAt,
      requiresSecondVerification: false,
      finalizationState: "signed",
      signedAt: "2026-09-01T03:31:00.000Z",
      replayed: false,
      persisted: true,
      demo: false,
      ...overrides,
    },
    errors: [],
  };
}

describe("medication browser receipt boundary", () => {
  it("accepts an exact new record receipt", () => {
    expect(
      parseMedicationActionSuccess(
        envelope(),
        {
          kind: "record",
          medicationAdministrationId: administrationId,
          status: "administered",
          occurredAt,
          mustRequireSecondVerification: false,
        },
        201,
      ),
    ).toMatchObject({
      requestId,
      data: { medicationAdministrationId: administrationId, replayed: false },
    });
  });

  it("allows only the documented five-minute clock skew and explicit offsets", () => {
    const expectation = {
      kind: "record" as const,
      medicationAdministrationId: administrationId,
      status: "administered" as const,
      occurredAt,
      mustRequireSecondVerification: false,
    };
    expect(
      parseMedicationActionSuccess(
        envelope({ signedAt: "2026-09-01T03:26:00.000Z" }),
        expectation,
        201,
      ).data.signedAt,
    ).toBe("2026-09-01T03:26:00.000Z");
    expect(() =>
      parseMedicationActionSuccess(
        envelope({ signedAt: "2026-09-01T03:24:59.999Z" }),
        expectation,
        201,
      ),
    ).toThrow("INVALID_MEDICATION_ACTION_RESPONSE");
    expect(() =>
      parseMedicationActionSuccess(
        envelope({ signedAt: "2026-09-01" }),
        expectation,
        201,
      ),
    ).toThrow("INVALID_MEDICATION_ACTION_RESPONSE");
  });

  it("rejects cross-record, demo, unexpected fields, and HTTP/replay drift", () => {
    const expectation = {
      kind: "record" as const,
      medicationAdministrationId: administrationId,
      status: "administered" as const,
      occurredAt,
      mustRequireSecondVerification: false,
    };
    for (const value of [
      envelope({
        medicationAdministrationId:
          "44444444-4444-4444-8444-444444444444",
      }),
      envelope({ demo: true }),
      envelope({ challengeId: "55555555-5555-4555-8555-555555555555" }),
    ]) {
      expect(() => parseMedicationActionSuccess(value, expectation, 201)).toThrow(
        "INVALID_MEDICATION_ACTION_RESPONSE",
      );
    }
    expect(() =>
      parseMedicationActionSuccess(envelope(), expectation, 200),
    ).toThrow("INVALID_MEDICATION_ACTION_RESPONSE");
  });

  it("requires a pending receipt for a high-risk first signature", () => {
    const expectation = {
      kind: "record" as const,
      medicationAdministrationId: administrationId,
      status: "administered" as const,
      occurredAt,
      mustRequireSecondVerification: true,
    };
    expect(() =>
      parseMedicationActionSuccess(envelope(), expectation, 201),
    ).toThrow("INVALID_MEDICATION_ACTION_RESPONSE");
    expect(
      parseMedicationActionSuccess(
        envelope({
          requiresSecondVerification: true,
          finalizationState: "pending_verification",
          signedAt: null,
        }),
        expectation,
        201,
      ).data.finalizationState,
    ).toBe("pending_verification");
  });

  it("correlates independent verification to the original outcome and timing", () => {
    const expectation = {
      kind: "verify" as const,
      medicationAdministrationId: administrationId,
      status: "administered" as const,
      occurredAt,
      executionSignedAt: "2026-09-01T03:31:00.000Z",
    };
    expect(
      parseMedicationActionSuccess(
        envelope({
          requiresSecondVerification: true,
          signedAt: "2026-09-01T03:32:00.000Z",
        }),
        expectation,
        201,
      ).data.signedAt,
    ).toBe("2026-09-01T03:32:00.000Z");
    expect(() =>
      parseMedicationActionSuccess(
        envelope({
          requiresSecondVerification: true,
          signedAt: "2026-09-01T03:30:30.000Z",
        }),
        expectation,
        201,
      ),
    ).toThrow("INVALID_MEDICATION_ACTION_RESPONSE");
  });

  it("accepts only a strict non-empty error envelope", () => {
    expect(
      parseMedicationActionError({
        requestId,
        status: "error",
        data: null,
        errors: [{ code: "AAL2_REQUIRED", message: "請重新驗證。" }],
      })?.requestId,
    ).toBe(requestId);
    expect(
      parseMedicationActionError({
        requestId,
        status: "error",
        data: null,
        errors: [],
      }),
    ).toBeNull();
  });

  it("extracts only a valid response request ID for safe incident display", () => {
    expect(parseMedicationResponseRequestId(envelope())).toBe(requestId);
    expect(parseMedicationResponseRequestId({ requestId: "not-a-uuid" })).toBeNull();
    expect(parseMedicationResponseRequestId(null)).toBeNull();
  });
});
