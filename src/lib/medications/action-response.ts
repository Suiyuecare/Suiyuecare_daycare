import { z } from "zod";

import type { MedicationOutcome } from "@/lib/integrations/medications";

const cleanText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);

const successDataSchema = z
  .object({
    operationId: z.uuid(),
    medicationAdministrationId: z.uuid(),
    status: z.enum(["administered", "refused", "held", "missed"]),
    occurredAt: z.string(),
    requiresSecondVerification: z.boolean(),
    finalizationState: z.enum(["pending_verification", "signed"]),
    signedAt: z.string().nullable(),
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  })
  .strict();

const successEnvelopeSchema = z
  .object({
    requestId: z.uuid(),
    status: z.literal("ok"),
    data: successDataSchema,
    errors: z.tuple([]),
  })
  .strict();

const errorEnvelopeSchema = z
  .object({
    requestId: z.uuid(),
    status: z.literal("error"),
    data: z.null(),
    errors: z
      .array(
        z
          .object({
            code: cleanText(120),
            message: cleanText(1_000),
            field: cleanText(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict();

const requestIdSchema = z
  .object({ requestId: z.uuid() })
  .strip();

export type MedicationActionExpectation =
  | {
      kind: "record";
      medicationAdministrationId: string;
      status: MedicationOutcome;
      occurredAt: string;
      mustRequireSecondVerification: boolean;
    }
  | {
      kind: "verify";
      medicationAdministrationId: string;
      status: MedicationOutcome;
      occurredAt: string;
      executionSignedAt: string;
    };

function invalidResponse(): never {
  throw new Error("INVALID_MEDICATION_ACTION_RESPONSE");
}

function instant(value: string) {
  if (!/(?:[zZ]|[+-]\d{2}:\d{2})$/u.test(value)) invalidResponse();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalidResponse();
  return parsed.toISOString();
}

function precedesBeyondClockSkew(left: string, right: string) {
  return new Date(left).getTime() + 5 * 60 * 1_000 < new Date(right).getTime();
}

export function parseMedicationActionSuccess(
  value: unknown,
  expectation: MedicationActionExpectation,
  httpStatus: number,
) {
  const parsed = successEnvelopeSchema.safeParse(value);
  if (!parsed.success) invalidResponse();

  const data = parsed.data.data;
  const occurredAt = instant(data.occurredAt);
  const expectedOccurredAt = instant(expectation.occurredAt);
  const signedAt = data.signedAt ? instant(data.signedAt) : null;
  if (
    data.medicationAdministrationId.toLowerCase() !==
      expectation.medicationAdministrationId.toLowerCase() ||
    data.status !== expectation.status ||
    occurredAt !== expectedOccurredAt ||
    (data.replayed ? httpStatus !== 200 : httpStatus !== 201)
  ) {
    invalidResponse();
  }

  if (expectation.kind === "record") {
    if (
      data.finalizationState === "pending_verification"
        ? !data.requiresSecondVerification || signedAt !== null
        : data.requiresSecondVerification ||
          signedAt === null ||
          precedesBeyondClockSkew(signedAt, occurredAt)
    ) {
      invalidResponse();
    }
    if (
      expectation.mustRequireSecondVerification &&
      (data.finalizationState !== "pending_verification" ||
        !data.requiresSecondVerification)
    ) {
      invalidResponse();
    }
  } else {
    const executionSignedAt = instant(expectation.executionSignedAt);
    if (
      data.finalizationState !== "signed" ||
      !data.requiresSecondVerification ||
      signedAt === null ||
      precedesBeyondClockSkew(signedAt, occurredAt) ||
      signedAt < executionSignedAt
    ) {
      invalidResponse();
    }
  }

  return {
    requestId: parsed.data.requestId.toLowerCase(),
    data: {
      ...data,
      operationId: data.operationId.toLowerCase(),
      medicationAdministrationId:
        data.medicationAdministrationId.toLowerCase(),
      occurredAt,
      signedAt,
    },
  };
}

export function parseMedicationActionError(value: unknown) {
  const parsed = errorEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseMedicationResponseRequestId(value: unknown) {
  const parsed = requestIdSchema.safeParse(value);
  return parsed.success ? parsed.data.requestId.toLowerCase() : null;
}
