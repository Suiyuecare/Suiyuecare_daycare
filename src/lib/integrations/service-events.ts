import { z } from "zod";

import { IntegrationError } from "./errors";
import {
  assertIdempotencyKey,
  assertUuid,
  parseIsoDateTime,
} from "./security";

const SERVICE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,39}$/u;
const MAX_EVIDENCE_BYTES = 4 * 1024;

const serviceEventCompletionSchema = z
  .object({
    client_id: z.uuid(),
    service_code: z.string().trim().min(1).max(40),
    started_at: z.string(),
    ended_at: z.string(),
    result: z.string().trim().min(1).max(240),
    notes: z.string().trim().max(2_000).optional(),
  })
  .strict();

export interface ServiceEventCompletionInput {
  clientId: string;
  serviceCode: string;
  startedAt: string;
  endedAt: string;
  result: string;
  notes: string | null;
  idempotencyKey: string;
}

export function parseServiceEventCompletion(
  value: unknown,
  headerIdempotencyKey?: string | null,
  now = new Date(),
  options: { enforceTimeWindow?: boolean } = {},
): ServiceEventCompletionInput {
  const parsed = serviceEventCompletionSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IntegrationError(
      "INVALID_SERVICE_EVENT",
      issue?.message || "服務紀錄欄位格式錯誤。",
      400,
      issue?.path.length ? issue.path.join(".") : undefined,
    );
  }

  const idempotencyKey = assertUuid(
    assertIdempotencyKey(headerIdempotencyKey),
    "idempotency_key",
  );
  const max = new Date(now.getTime() + 5 * 60 * 1_000);
  const min = options.enforceTimeWindow === false
    ? undefined
    : new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const startedAt = parseIsoDateTime(
    parsed.data.started_at,
    "started_at",
    { min, max },
  );
  const endedAt = parseIsoDateTime(parsed.data.ended_at, "ended_at", {
    min,
    max,
  });
  if (new Date(endedAt) < new Date(startedAt)) {
    throw new IntegrationError(
      "INVALID_SERVICE_PERIOD",
      "服務結束時間不可早於開始時間。",
      400,
      "ended_at",
    );
  }

  const serviceCode = parsed.data.service_code.toUpperCase();
  if (!SERVICE_CODE_PATTERN.test(serviceCode)) {
    throw new IntegrationError(
      "INVALID_SERVICE_CODE",
      "服務代碼須為 1 至 40 字元，且只能使用英數字、點、底線、斜線或連字號。",
      400,
      "service_code",
    );
  }

  const result = parsed.data.result.trim();
  const notes = parsed.data.notes?.trim() || null;
  const evidence = { result, ...(notes ? { notes } : {}) };
  if (Buffer.byteLength(JSON.stringify(evidence), "utf8") > MAX_EVIDENCE_BYTES) {
    throw new IntegrationError(
      "SERVICE_EVIDENCE_TOO_LARGE",
      "服務結果與備註合計超過允許大小。",
      400,
      "notes",
    );
  }

  return {
    clientId: parsed.data.client_id.toLowerCase(),
    serviceCode,
    startedAt,
    endedAt,
    result,
    notes,
    idempotencyKey,
  };
}
