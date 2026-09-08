import { describe, expect, it } from "vitest";

import { IntegrationError } from "./errors";
import {
  parseMedicationAdministration,
  parseMedicationVerification,
} from "./medications";

const administrationId = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-09-01T04:00:00.000Z");

function administered() {
  return {
    medication_administration_id: administrationId,
    status: "administered",
    occurred_at: "2026-09-01T11:30:00+08:00",
    actual_dose: 10,
    dose_unit: "mg",
  };
}

describe("dedicated medication administration input", () => {
  it("normalizes a planned dose, zoned occurrence, and UUID receipt key", () => {
    expect(
      parseMedicationAdministration(administered(), idempotencyKey, now),
    ).toEqual({
      medicationAdministrationId: administrationId,
      status: "administered",
      occurredAt: "2026-09-01T03:30:00.000Z",
      actualDose: 10,
      doseUnit: "mg",
      reason: null,
      idempotencyKey,
    });
  });

  it("requires reason-only evidence for refused, held, and missed", () => {
    for (const status of ["refused", "held", "missed"] as const) {
      expect(
        parseMedicationAdministration(
          {
            medication_administration_id: administrationId,
            status,
            occurred_at: "2026-09-01T11:30:00+08:00",
            reason: " 已確認原因 ",
          },
          idempotencyKey,
          now,
        ),
      ).toMatchObject({
        status,
        actualDose: null,
        doseUnit: null,
        reason: "已確認原因",
      });
    }
  });

  it("rejects missing exception reasons and dose fields on non-administered outcomes", () => {
    expect(() =>
      parseMedicationAdministration(
        {
          medication_administration_id: administrationId,
          status: "refused",
          occurred_at: "2026-09-01T11:30:00+08:00",
        },
        idempotencyKey,
        now,
      ),
    ).toThrowError(/原因/u);
    expect(() =>
      parseMedicationAdministration(
        {
          medication_administration_id: administrationId,
          status: "held",
          occurred_at: "2026-09-01T11:30:00+08:00",
          reason: "暫停",
          actual_dose: 10,
          dose_unit: "mg",
        },
        idempotencyKey,
        now,
      ),
    ).toThrowError(/不可填寫/u);
  });

  it("rejects non-finite, non-positive, or excess-precision doses", () => {
    for (const actualDose of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.00001]) {
      expect(() =>
        parseMedicationAdministration(
          { ...administered(), actual_dose: actualDose },
          idempotencyKey,
          now,
        ),
      ).toThrowError(IntegrationError);
    }
  });

  it("rejects caller-authored scope, plan, staff, source, signatures, hashes, and body retry key", () => {
    for (const field of [
      "organization_id",
      "branch_id",
      "medication_plan_id",
      "recorded_by",
      "second_verified_by",
      "source",
      "late_entry",
      "requires_second_verification",
      "signed_at",
      "content_hash",
      "execution_reauth_challenge_id",
      "verification_reauth_challenge_id",
      "idempotency_key",
    ]) {
      expect(() =>
        parseMedicationAdministration(
          { ...administered(), [field]: "caller-value" },
          idempotencyKey,
          now,
        ),
      ).toThrowError(IntegrationError);
    }
  });

  it("keeps the 24-hour/+5-minute gate in demo and lets production replay reach the ledger", () => {
    const old = { ...administered(), occurred_at: "2026-08-31T11:29:59+08:00" };
    expect(() =>
      parseMedicationAdministration(old, idempotencyKey, now),
    ).toThrowError(/超過允許範圍/u);
    expect(
      parseMedicationAdministration(old, idempotencyKey, now, {
        enforceTimeWindow: false,
      }).occurredAt,
    ).toBe("2026-08-31T03:29:59.000Z");
  });

  it("accepts only a slot ID for independent verification", () => {
    expect(
      parseMedicationVerification(
        { medication_administration_id: administrationId },
        idempotencyKey,
      ),
    ).toEqual({
      medicationAdministrationId: administrationId,
      idempotencyKey,
    });

    for (const field of [
      "organization_id",
      "branch_id",
      "verifier_id",
      "verified_at",
      "signature",
      "content_hash",
    ]) {
      expect(() =>
        parseMedicationVerification(
          {
            medication_administration_id: administrationId,
            [field]: "caller-value",
          },
          idempotencyKey,
        ),
      ).toThrowError(IntegrationError);
    }
  });
});
