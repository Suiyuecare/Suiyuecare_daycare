import { z } from "zod";

import { IntegrationError } from "./errors";
import {
  assertIdempotencyKey,
  deterministicUuid,
  parseIsoDateTime,
  payloadHash,
} from "./security";

const vitalValuesSchema = z
  .object({
    systolic: z.number().finite().int().min(20).max(350).optional(),
    diastolic: z.number().finite().int().min(10).max(250).optional(),
    pulse: z.number().finite().int().min(10).max(350).optional(),
    temperature: z
      .number()
      .finite()
      .multipleOf(0.1)
      .min(20)
      .max(50)
      .optional(),
    oxygen_saturation: z.number().finite().int().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((values, context) => {
    if (Object.values(values).every((value) => value == null)) {
      context.addIssue({
        code: "custom",
        message: "至少需要一項量測值。",
      });
    }
    if ((values.systolic == null) !== (values.diastolic == null)) {
      context.addIssue({
        code: "custom",
        message: "收縮壓與舒張壓必須一起填寫。",
        path: [values.systolic == null ? "systolic" : "diastolic"],
      });
    }
  });

const vitalSetSchema = z
  .object({
    client_id: z.uuid(),
    measured_at: z.string(),
    values: vitalValuesSchema,
    idempotency_key: z.string().optional(),
  })
  .strict();

export type VitalKind =
  | "blood_pressure_systolic"
  | "blood_pressure_diastolic"
  | "pulse"
  | "temperature"
  | "oxygen_saturation";

export interface VitalSetInput {
  clientId: string;
  measuredAt: string;
  values: {
    systolic?: number;
    diastolic?: number;
    pulse?: number;
    temperature?: number;
    oxygen_saturation?: number;
  };
  idempotencyKey: string;
  contentHash: string;
}

export interface VitalMeasurementRow {
  measurementKind: VitalKind;
  numericValue: number;
  unit: "mmHg" | "bpm" | "°C" | "%";
  idempotencyKey: string;
}

const definitions: ReadonlyArray<{
  inputKey: keyof VitalSetInput["values"];
  kind: VitalKind;
  unit: VitalMeasurementRow["unit"];
}> = [
  { inputKey: "systolic", kind: "blood_pressure_systolic", unit: "mmHg" },
  { inputKey: "diastolic", kind: "blood_pressure_diastolic", unit: "mmHg" },
  { inputKey: "pulse", kind: "pulse", unit: "bpm" },
  { inputKey: "temperature", kind: "temperature", unit: "°C" },
  { inputKey: "oxygen_saturation", kind: "oxygen_saturation", unit: "%" },
];

export function parseVitalSet(
  value: unknown,
  headerIdempotencyKey?: string | null,
  now = new Date(),
  options: { enforceTimeWindow?: boolean } = {},
): VitalSetInput {
  const parsed = vitalSetSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IntegrationError(
      "INVALID_VITAL_SET",
      issue?.message || "生命徵象欄位格式錯誤。",
      400,
      issue?.path.length ? issue.path.join(".") : undefined,
    );
  }

  const idempotencyKey = assertIdempotencyKey(
    headerIdempotencyKey ?? parsed.data.idempotency_key,
  );
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
  const hashBasis = {
    schema_version: 1,
    client_id: parsed.data.client_id,
    measured_at: measuredAt,
    values: parsed.data.values,
  };

  return {
    clientId: parsed.data.client_id,
    measuredAt,
    values: parsed.data.values,
    idempotencyKey,
    contentHash: payloadHash(hashBasis),
  };
}

export function vitalMeasurementRows(
  organizationId: string,
  userId: string,
  input: VitalSetInput,
): VitalMeasurementRow[] {
  return definitions.flatMap((definition) => {
    const value = input.values[definition.inputKey];
    return value == null
      ? []
      : [
          {
            measurementKind: definition.kind,
            numericValue: value,
            unit: definition.unit,
            idempotencyKey: deterministicUuid(
              "vital-set",
              organizationId,
              userId,
              input.idempotencyKey,
              definition.kind,
            ),
          },
        ];
  });
}

export function vitalSetDatabaseKey(
  organizationId: string,
  userId: string,
  input: Pick<VitalSetInput, "idempotencyKey">,
) {
  return deterministicUuid(
    "vital-set",
    organizationId,
    userId,
    input.idempotencyKey,
  );
}

export function storedVitalSetMatches(
  stored: ReadonlyArray<{
    client_id: string;
    measurement_kind: string;
    measured_at: string;
    numeric_value: string | number | null;
    unit: string | null;
    context: unknown;
    idempotency_key: string;
  }>,
  rows: readonly VitalMeasurementRow[],
  input: VitalSetInput,
) {
  if (stored.length !== rows.length) return false;
  const expected = new Map(rows.map((row) => [row.idempotencyKey, row]));
  return stored.every((record) => {
    const row = expected.get(record.idempotency_key);
    const context = record.context as
      | { _request?: { idempotency_hash?: unknown } }
      | null;
    return Boolean(
      row &&
        record.client_id === input.clientId &&
        record.measurement_kind === row.measurementKind &&
        new Date(record.measured_at).toISOString() === input.measuredAt &&
        Number(record.numeric_value) === row.numericValue &&
        record.unit === row.unit &&
        context?._request?.idempotency_hash === input.contentHash,
    );
  });
}
