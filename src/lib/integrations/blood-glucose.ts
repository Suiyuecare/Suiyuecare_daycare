import { z } from "zod";

import { BLOOD_GLUCOSE_MEAL_CONTEXTS, BLOOD_GLUCOSE_UNITS,
  type BloodGlucoseMealContext, type BloodGlucoseUnit } from "@/lib/blood-glucose/constants";

import { IntegrationError } from "./errors";
import {
  assertIdempotencyKey,
  deterministicUuid,
  parseIsoDateTime,
} from "./security";

export { BLOOD_GLUCOSE_MEAL_CONTEXTS, BLOOD_GLUCOSE_UNITS };
export type { BloodGlucoseMealContext, BloodGlucoseUnit };

const bloodGlucoseSchema = z
  .object({
    client_id: z.uuid(),
    measured_at: z.string(),
    meal_context: z.enum(BLOOD_GLUCOSE_MEAL_CONTEXTS),
    value: z.number().finite(),
    unit: z.enum(BLOOD_GLUCOSE_UNITS),
  })
  .strict()
  .superRefine((measurement, context) => {
    if (measurement.unit === "mg/dL") {
      if (
        !Number.isInteger(measurement.value) ||
        measurement.value < 20 ||
        measurement.value > 600
      ) {
        context.addIssue({
          code: "custom",
          message: "mg/dL 必須是 20 至 600 的整數。",
          path: ["value"],
        });
      }
      return;
    }

    const tenths = measurement.value * 10;
    if (
      Math.abs(tenths - Math.round(tenths)) > 1e-9 ||
      measurement.value < 1.1 ||
      measurement.value > 33.3
    ) {
      context.addIssue({
        code: "custom",
        message: "mmol/L 必須是 1.1 至 33.3，且最多一位小數。",
        path: ["value"],
      });
    }
  });

export interface BloodGlucoseInput {
  clientId: string;
  measuredAt: string;
  mealContext: BloodGlucoseMealContext;
  value: number;
  unit: BloodGlucoseUnit;
  idempotencyKey: string;
}

export function parseBloodGlucoseMeasurement(
  value: unknown,
  headerIdempotencyKey: string | null,
  now = new Date(),
  options: { enforceTimeWindow?: boolean } = {},
): BloodGlucoseInput {
  const parsed = bloodGlucoseSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IntegrationError(
      "INVALID_BLOOD_GLUCOSE",
      issue?.message || "血糖量測欄位格式錯誤。",
      400,
      issue?.path.length ? issue.path.join(".") : undefined,
    );
  }

  const measuredAt = parseIsoDateTime(
    parsed.data.measured_at,
    "measured_at",
    options.enforceTimeWindow === false
      ? undefined
      : {
          min: new Date(now.getTime() - 24 * 60 * 60 * 1_000),
          max: new Date(now.getTime() + 5 * 60 * 1_000),
        },
  );

  return {
    clientId: parsed.data.client_id,
    measuredAt,
    mealContext: parsed.data.meal_context,
    value: parsed.data.value,
    unit: parsed.data.unit,
    idempotencyKey: assertIdempotencyKey(headerIdempotencyKey),
  };
}

export function bloodGlucoseDatabaseKey(
  organizationId: string,
  branchId: string,
  userId: string,
  input: Pick<BloodGlucoseInput, "idempotencyKey">,
) {
  return deterministicUuid(
    "blood-glucose",
    organizationId,
    branchId,
    userId,
    input.idempotencyKey,
  );
}
