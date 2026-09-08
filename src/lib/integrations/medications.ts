import { z } from "zod";

import { IntegrationError } from "./errors";
import {
  assertIdempotencyKey,
  assertUuid,
  parseIsoDateTime,
} from "./security";

export const MEDICATION_OUTCOMES = [
  "administered",
  "refused",
  "held",
  "missed",
] as const;

export type MedicationOutcome = (typeof MEDICATION_OUTCOMES)[number];

const recordSchema = z
  .object({
    medication_administration_id: z.uuid(),
    status: z.enum(MEDICATION_OUTCOMES),
    occurred_at: z.string(),
    actual_dose: z.number().finite().positive().max(99_999_999.9999).optional(),
    dose_unit: z.string().trim().min(1).max(32).optional(),
    reason: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.status === "administered") {
      if (input.actual_dose === undefined) {
        context.addIssue({
          code: "custom",
          message: "服用狀態必須填寫實際劑量。",
          path: ["actual_dose"],
        });
      }
      if (!input.dose_unit) {
        context.addIssue({
          code: "custom",
          message: "服用狀態必須帶入用藥計畫單位。",
          path: ["dose_unit"],
        });
      }
      return;
    }

    if (!input.reason) {
      context.addIssue({
        code: "custom",
        message: "拒絕、暫停或漏服必須填寫原因。",
        path: ["reason"],
      });
    }
    if (input.actual_dose !== undefined || input.dose_unit !== undefined) {
      context.addIssue({
        code: "custom",
        message: "拒絕、暫停或漏服不可填寫已服用劑量。",
        path: ["actual_dose"],
      });
    }
  });

const verifySchema = z
  .object({ medication_administration_id: z.uuid() })
  .strict();

export type MedicationAdministrationInput = {
  medicationAdministrationId: string;
  status: MedicationOutcome;
  occurredAt: string;
  actualDose: number | null;
  doseUnit: string | null;
  reason: string | null;
  idempotencyKey: string;
};

export type MedicationVerificationInput = {
  medicationAdministrationId: string;
  idempotencyKey: string;
};

export function parseMedicationAdministration(
  value: unknown,
  headerIdempotencyKey: string | null,
  now = new Date(),
  options: { enforceTimeWindow?: boolean } = {},
): MedicationAdministrationInput {
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IntegrationError(
      "INVALID_MEDICATION_ADMINISTRATION",
      issue?.message || "用藥執行欄位格式錯誤。",
      400,
      issue?.path.length ? issue.path.join(".") : undefined,
    );
  }

  const occurredAt = parseIsoDateTime(
    parsed.data.occurred_at,
    "occurred_at",
    options.enforceTimeWindow === false
      ? undefined
      : {
          min: new Date(now.getTime() - 24 * 60 * 60 * 1_000),
          max: new Date(now.getTime() + 5 * 60 * 1_000),
        },
  );

  const actualDose = parsed.data.actual_dose ?? null;
  if (
    actualDose !== null &&
    Math.abs(actualDose * 10_000 - Math.round(actualDose * 10_000)) > 1e-7
  ) {
    throw new IntegrationError(
      "INVALID_MEDICATION_DOSE",
      "實際劑量最多四位小數。",
      400,
      "actual_dose",
    );
  }

  return {
    medicationAdministrationId: parsed.data.medication_administration_id,
    status: parsed.data.status,
    occurredAt,
    actualDose,
    doseUnit: parsed.data.dose_unit?.trim() ?? null,
    reason: parsed.data.reason?.trim() ?? null,
    idempotencyKey: assertUuid(
      assertIdempotencyKey(headerIdempotencyKey),
      "idempotency_key",
    ),
  };
}

export function parseMedicationVerification(
  value: unknown,
  headerIdempotencyKey: string | null,
): MedicationVerificationInput {
  const parsed = verifySchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IntegrationError(
      "INVALID_MEDICATION_VERIFICATION",
      issue?.message || "用藥覆核欄位格式錯誤。",
      400,
      issue?.path.length ? issue.path.join(".") : undefined,
    );
  }

  return {
    medicationAdministrationId: parsed.data.medication_administration_id,
    idempotencyKey: assertUuid(
      assertIdempotencyKey(headerIdempotencyKey),
      "idempotency_key",
    ),
  };
}
