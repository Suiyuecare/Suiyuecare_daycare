import { z } from "zod";

import { IntegrationError } from "./errors";
import {
  assertIdempotencyKey,
  parseIsoDateTime,
  payloadHash,
} from "./security";

export const allowedOfflineEntityTypes = [
  "vital-sign",
  "care-note",
  "attendance",
] as const;

export type AllowedOfflineEntityType =
  (typeof allowedOfflineEntityTypes)[number];

const forbiddenOfflinePattern =
  /med(?:ication)?|insulin|藥|胰島素|financ|billing|invoice|payment|claim|申報|帳務/iu;

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const commonPayload = {
  client_id: z.uuid(),
};

const vitalSignPayloadSchema = z
  .object({
    ...commonPayload,
    measured_at: z.string(),
    measurement_kind: z.string().trim().min(1).max(80),
    numeric_value: z.number().finite().optional(),
    text_value: z.string().trim().min(1).max(500).optional(),
    unit: z.string().trim().min(1).max(40).optional(),
    context: z.record(z.string(), jsonValueSchema).default({}),
  })
  .strict()
  .refine(
    (value) =>
      Number(value.numeric_value !== undefined) +
        Number(value.text_value !== undefined) ===
      1,
    { message: "生命徵象必須且只能提供一種數值。" },
  );

const careNotePayloadSchema = z
  .object({
    ...commonPayload,
    occurred_at: z.string(),
    fields: z.record(z.string(), jsonValueSchema),
  })
  .strict();

const attendancePayloadSchema = z
  .object({
    ...commonPayload,
    service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    status: z.enum(["present", "absent", "leave", "cancelled"]),
    checked_in_at: z.string().nullable().optional(),
    checked_out_at: z.string().nullable().optional(),
    source: z.string().trim().min(1).max(80).default("pwa"),
  })
  .strict();

const operationSchema = z
  .object({
    idempotency_key: z.string(),
    entity_type: z.string().trim().min(1).max(80),
    entity_id: z.uuid(),
    base_version: z.number().int().min(0),
    occurred_at: z.string(),
    device_id: z.string().trim().min(8).max(200),
    payload_hash: z.string().regex(/^[a-f0-9]{64}$/u),
    payload: z.record(z.string(), jsonValueSchema),
  })
  .strict();

const batchSchema = z
  .object({
    operations: z.array(z.unknown()).min(1).max(100),
  })
  .strict();

export interface OfflineSyncOperation {
  idempotencyKey: string;
  entityType: AllowedOfflineEntityType;
  entityId: string;
  baseVersion: number;
  occurredAt: string;
  deviceId: string;
  payloadHash: string;
  clientId: string;
  payload: Record<string, unknown>;
}

export function parseSyncBatch(
  value: unknown,
  now = new Date(),
): OfflineSyncOperation[] {
  const batch = batchSchema.safeParse(value);
  if (!batch.success) {
    const issue = batch.error.issues[0];
    throw new IntegrationError(
      "INVALID_SYNC_BATCH",
      "離線同步批次格式錯誤，且每批最多 100 筆。",
      400,
      issue?.path.join(".") || undefined,
    );
  }

  const min = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const max = new Date(now.getTime() + 5 * 60 * 1000);

  return batch.data.operations.map((raw, index) => {
    const parsed = operationSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new IntegrationError(
        "INVALID_SYNC_OPERATION",
        "離線同步項目格式錯誤。",
        400,
        `operations.${index}${issue?.path.length ? `.${issue.path.join(".")}` : ""}`,
      );
    }

    const entityType = parsed.data.entity_type;
    if (forbiddenOfflinePattern.test(entityType)) {
      throw new IntegrationError(
        "OFFLINE_ENTITY_FORBIDDEN",
        "用藥、財務與申報資料不得離線同步。",
        403,
        `operations.${index}.entity_type`,
      );
    }
    if (
      !allowedOfflineEntityTypes.includes(
        entityType as AllowedOfflineEntityType,
      )
    ) {
      throw new IntegrationError(
        "OFFLINE_ENTITY_NOT_ALLOWED",
        "此資料類型不在離線同步白名單。",
        403,
        `operations.${index}.entity_type`,
      );
    }

    const allowedType = entityType as AllowedOfflineEntityType;
    const payloadSchema =
      allowedType === "vital-sign"
        ? vitalSignPayloadSchema
        : allowedType === "care-note"
          ? careNotePayloadSchema
          : attendancePayloadSchema;
    const payload = payloadSchema.safeParse(parsed.data.payload);
    if (!payload.success) {
      const issue = payload.error.issues[0];
      throw new IntegrationError(
        "INVALID_SYNC_PAYLOAD",
        "離線資料內容不完整或格式錯誤。",
        400,
        `operations.${index}.payload${issue?.path.length ? `.${issue.path.join(".")}` : ""}`,
      );
    }

    const occurredAt = parseIsoDateTime(
      parsed.data.occurred_at,
      `operations.${index}.occurred_at`,
      { min, max },
    );
    if (allowedType === "vital-sign") {
      parseIsoDateTime(
        (payload.data as z.infer<typeof vitalSignPayloadSchema>).measured_at,
        `operations.${index}.payload.measured_at`,
        { min, max },
      );
    } else if (allowedType === "care-note") {
      parseIsoDateTime(
        (payload.data as z.infer<typeof careNotePayloadSchema>).occurred_at,
        `operations.${index}.payload.occurred_at`,
        { min, max },
      );
    } else {
      const attendance = payload.data as z.infer<
        typeof attendancePayloadSchema
      >;
      const checkedIn = attendance.checked_in_at
        ? parseIsoDateTime(
            attendance.checked_in_at,
            `operations.${index}.payload.checked_in_at`,
            { min, max },
          )
        : null;
      const checkedOut = attendance.checked_out_at
        ? parseIsoDateTime(
            attendance.checked_out_at,
            `operations.${index}.payload.checked_out_at`,
            { min, max },
          )
        : null;
      if (checkedIn && checkedOut && checkedOut < checkedIn) {
        throw new IntegrationError(
          "INVALID_ATTENDANCE_PERIOD",
          "簽退時間不得早於簽到時間。",
          400,
          `operations.${index}.payload.checked_out_at`,
        );
      }
    }

    const calculatedHash = payloadHash(payload.data);
    if (calculatedHash !== parsed.data.payload_hash) {
      throw new IntegrationError(
        "PAYLOAD_HASH_MISMATCH",
        "離線資料雜湊與內容不符。",
        409,
        `operations.${index}.payload_hash`,
      );
    }

    return {
      idempotencyKey: assertIdempotencyKey(
        parsed.data.idempotency_key,
        `operations.${index}.idempotency_key`,
      ),
      entityType: allowedType,
      entityId: parsed.data.entity_id,
      baseVersion: parsed.data.base_version,
      occurredAt,
      deviceId: parsed.data.device_id,
      payloadHash: calculatedHash,
      clientId: (payload.data as { client_id: string }).client_id,
      payload: payload.data as Record<string, unknown>,
    };
  });
}

export function hasVersionConflict(
  baseVersion: number,
  currentVersion: number,
) {
  return baseVersion !== currentVersion;
}

