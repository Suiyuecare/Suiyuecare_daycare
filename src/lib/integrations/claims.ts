import { z } from "zod";

import { IntegrationError } from "./errors";
import {
  assertIdempotencyKey,
  canonicalJson,
  payloadHash,
} from "./security";

const moneySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/u)
  .max(15);

export const MAX_CLAIM_RECONCILIATION_BYTES = 2 * 1024 * 1024;
export const MAX_CLAIM_RECONCILIATION_ITEMS = 5000;
export const MAX_CLAIM_RESPONSE_CODE_BYTES = 40;
export const MAX_CLAIM_RESPONSE_MESSAGE_BYTES = 64;

const unsafeControlPattern = /[\u0000-\u001f\u007f]/u;
const utf8Length = (value: string) => new TextEncoder().encode(value).length;

function hasUnpairedSurrogate(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

const isSafeResponseText = (value: string) =>
  !unsafeControlPattern.test(value) && !hasUnpairedSurrogate(value);

const responseCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_CLAIM_RESPONSE_CODE_BYTES)
  .regex(/^[A-Za-z0-9._:/-]+$/u)
  .refine((value) => utf8Length(value) <= MAX_CLAIM_RESPONSE_CODE_BYTES)
  .refine(isSafeResponseText);

const responseMessageSchema = z
  .string()
  .trim()
  .max(MAX_CLAIM_RESPONSE_MESSAGE_BYTES)
  .refine((value) => utf8Length(value) <= MAX_CLAIM_RESPONSE_MESSAGE_BYTES)
  .refine(isSafeResponseText);

const exportSchema = z
  .object({
    idempotency_key: z.string().optional(),
    claim_batch_id: z.uuid(),
    expected_total_amount: moneySchema,
  })
  .strict();

const reconciliationResultSchema = z
  .object({
    claim_item_id: z.uuid(),
    outcome: z.enum(["accepted", "rejected"]),
    response_code: responseCodeSchema,
    response_message: responseMessageSchema.nullable().optional(),
  })
  .strict();

const reconcileSchema = z
  .object({
    idempotency_key: z.string().optional(),
    claim_batch_id: z.uuid(),
    expected_total_amount: moneySchema,
    results: z
      .array(reconciliationResultSchema)
      .min(1)
      .max(MAX_CLAIM_RECONCILIATION_ITEMS),
  })
  .strict();

export interface ClaimExportRequest {
  idempotencyKey: string;
  claimBatchId: string;
  expectedTotalAmount: string;
}

export interface ClaimReconciliationRequest extends ClaimExportRequest {
  results: Array<{
    claimItemId: string;
    outcome: "accepted" | "rejected";
    responseCode: string;
    responseMessage: string | null;
  }>;
}

export interface ClaimSnapshotItem {
  id: string;
  client_id: string;
  service_event_id: string;
  service_code: string;
  service_date: string;
  units: string | number;
  amount: string | number;
  evidence_hash: string;
}

export interface ClaimSnapshotBatch {
  id: string;
  claim_period_start: string;
  claim_period_end: string;
  format_version: string;
}

export type ClaimExportDatabaseFailure = {
  code: string;
  message: string;
  httpStatus: number;
};

export function classifyClaimExportDatabaseFailure(
  databaseCode?: string,
): ClaimExportDatabaseFailure {
  if (databaseCode === "42501") {
    return {
      code: "CLAIM_EXPORT_NOT_AUTHORIZED",
      message: "目前角色或重新驗證狀態不允許匯出。",
      httpStatus: 403,
    };
  }
  if (databaseCode === "23505") {
    return {
      code: "CLAIM_EXPORT_IDEMPOTENCY_CONFLICT",
      message: "相同冪等鍵曾用於不同的申報匯出內容。",
      httpStatus: 409,
    };
  }
  if (databaseCode === "23514") {
    return {
      code: "CLAIM_EXPORT_REJECTED",
      message: "服務已由其他批次配置，或申報明細未通過匯出驗證。",
      httpStatus: 422,
    };
  }
  if (databaseCode === "P2001") {
    return {
      code: "CLAIM_EXPORT_ALREADY_COMPLETED",
      message: "此批次已由另一項操作完成匯出，請重新載入最新狀態。",
      httpStatus: 409,
    };
  }
  return {
    code: "CLAIM_EXPORT_FAILED",
    message: "申報批次未建立快照；請確認明細與總額後，以相同冪等鍵重試。",
    httpStatus: 409,
  };
}

export function parseClaimExportRequest(
  value: unknown,
  headerIdempotencyKey?: string | null,
): ClaimExportRequest {
  const parsed = exportSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IntegrationError(
      "INVALID_CLAIM_EXPORT",
      "申報匯出內容格式錯誤。",
      400,
      issue?.path.join(".") || undefined,
    );
  }
  return {
    idempotencyKey: assertIdempotencyKey(
      headerIdempotencyKey ?? parsed.data.idempotency_key,
    ),
    claimBatchId: parsed.data.claim_batch_id,
    expectedTotalAmount: normalizeMoney(parsed.data.expected_total_amount),
  };
}

export function parseClaimValidationRequest(
  value: unknown,
  headerIdempotencyKey?: string | null,
): ClaimExportRequest & { expectedItemCount: number } {
  const parsed = exportSchema.extend({ expected_item_count: z.number().int().min(1).max(5000) }).safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IntegrationError(
      "INVALID_CLAIM_VALIDATION",
      "申報驗證內容格式錯誤。",
      400,
      issue?.path.join(".") || undefined,
    );
  }
  return {
    idempotencyKey: assertIdempotencyKey(
      headerIdempotencyKey ?? parsed.data.idempotency_key,
    ),
    claimBatchId: parsed.data.claim_batch_id,
    expectedItemCount: parsed.data.expected_item_count,
    expectedTotalAmount: normalizeMoney(parsed.data.expected_total_amount),
  };
}

export function parseClaimReconciliationRequest(
  value: unknown,
  headerIdempotencyKey?: string | null,
): ClaimReconciliationRequest {
  const parsed = reconcileSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IntegrationError(
      "INVALID_CLAIM_RECONCILIATION",
      "申報對帳內容格式錯誤。",
      400,
      issue?.path.join(".") || undefined,
    );
  }

  const seen = new Set<string>();
  const results = parsed.data.results.map((result, index) => {
    if (seen.has(result.claim_item_id)) {
      throw new IntegrationError(
        "DUPLICATE_CLAIM_RESULT",
        "同一申報明細不得出現兩次。",
        400,
        `results.${index}.claim_item_id`,
      );
    }
    seen.add(result.claim_item_id);
    return {
      claimItemId: result.claim_item_id,
      outcome: result.outcome,
      responseCode: result.response_code,
      responseMessage: result.response_message ?? null,
    };
  });

  return {
    idempotencyKey: assertIdempotencyKey(
      headerIdempotencyKey ?? parsed.data.idempotency_key,
    ),
    claimBatchId: parsed.data.claim_batch_id,
    expectedTotalAmount: normalizeMoney(parsed.data.expected_total_amount),
    results,
  };
}

function scaledInteger(
  value: string | number,
  scale: number,
  field: string,
) {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^\d+(?:\.\d+)?$/u.test(raw)) {
    throw new IntegrationError(
      "INVALID_DECIMAL",
      "申報數值格式錯誤。",
      409,
      field,
    );
  }
  const [whole, fraction = ""] = raw.split(".");
  if (fraction.length > scale) {
    throw new IntegrationError(
      "DECIMAL_PRECISION_EXCEEDED",
      "申報金額或數量的小數位數超過允許範圍。",
      409,
      field,
    );
  }
  const scaled = `${whole}${fraction.padEnd(scale, "0")}`.replace(
    /^0+(?=\d)/u,
    "",
  );
  return scaled || "0";
}

function addUnsignedIntegers(left: string, right: string) {
  let carry = 0;
  let result = "";
  let leftIndex = left.length - 1;
  let rightIndex = right.length - 1;
  while (leftIndex >= 0 || rightIndex >= 0 || carry > 0) {
    const sum =
      (leftIndex >= 0 ? Number(left[leftIndex--]) : 0) +
      (rightIndex >= 0 ? Number(right[rightIndex--]) : 0) +
      carry;
    result = `${sum % 10}${result}`;
    carry = Math.floor(sum / 10);
  }
  return result.replace(/^0+(?=\d)/u, "") || "0";
}

function formatScaledInteger(value: string, scale: number) {
  const padded = value.padStart(scale + 1, "0");
  const whole = padded.slice(0, -scale) || "0";
  const fraction = padded.slice(-scale);
  return `${whole}.${fraction}`;
}

export function normalizeMoney(value: string | number) {
  return formatScaledInteger(scaledInteger(value, 2, "amount"), 2);
}

export function sumMoney(values: readonly (string | number)[]) {
  const totalCents = values.reduce<string>(
    (total, value, index) =>
      addUnsignedIntegers(
        total,
        scaledInteger(value, 2, `amounts.${index}`),
      ),
    "0",
  );
  return formatScaledInteger(totalCents, 2);
}

export function buildClaimSnapshot(
  batch: ClaimSnapshotBatch,
  items: ClaimSnapshotItem[],
  expectedTotalAmount: string,
) {
  if (items.length === 0) {
    throw new IntegrationError(
      "EMPTY_CLAIM_BATCH",
      "申報批次沒有可匯出的明細。",
      409,
    );
  }

  const seen = new Set<string>();
  let totalCents = "0";
  const normalizedItems = [...items]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item, index) => {
      if (seen.has(item.id)) {
        throw new IntegrationError(
          "DUPLICATE_CLAIM_ITEM",
          "申報批次包含重複明細。",
          409,
          `items.${index}.id`,
        );
      }
      seen.add(item.id);
      const amount = normalizeMoney(item.amount);
      const units = formatScaledInteger(
        scaledInteger(item.units, 4, `items.${index}.units`),
        4,
      );
      totalCents = addUnsignedIntegers(
        totalCents,
        scaledInteger(amount, 2, `items.${index}.amount`),
      );
      if (!/^[a-f0-9]{64}$/u.test(item.evidence_hash)) {
        throw new IntegrationError(
          "INVALID_CLAIM_EVIDENCE",
          "申報明細缺少有效的服務證據雜湊。",
          409,
          `items.${index}.evidence_hash`,
        );
      }
      return {
        id: item.id,
        client_id: item.client_id,
        service_event_id: item.service_event_id,
        service_code: item.service_code,
        service_date: item.service_date,
        units,
        amount,
        evidence_hash: item.evidence_hash,
      };
    });

  const totalAmount = formatScaledInteger(totalCents, 2);
  if (totalAmount !== normalizeMoney(expectedTotalAmount)) {
    throw new IntegrationError(
      "CLAIM_TOTAL_MISMATCH",
      "申報明細總額與操作人員確認的總額不一致。",
      409,
      "expected_total_amount",
    );
  }

  const snapshot = {
    schema_version: 1,
    batch: {
      id: batch.id,
      claim_period_start: batch.claim_period_start,
      claim_period_end: batch.claim_period_end,
      format_version: batch.format_version,
    },
    item_count: normalizedItems.length,
    total_amount: totalAmount,
    items: normalizedItems,
  };

  return {
    snapshot,
    snapshotHash: payloadHash(snapshot),
    itemCount: normalizedItems.length,
    totalAmount,
    canonicalSnapshot: canonicalJson(snapshot),
  };
}

export function validateReconciliationCoverage(
  itemIds: string[],
  request: ClaimReconciliationRequest,
) {
  const expected = [...itemIds].sort();
  const actual = request.results.map((result) => result.claimItemId).sort();
  if (
    expected.length !== actual.length ||
    expected.some((id, index) => id !== actual[index])
  ) {
    throw new IntegrationError(
      "CLAIM_RECONCILIATION_INCOMPLETE",
      "對帳結果必須逐筆涵蓋申報批次全部明細。",
      409,
      "results",
    );
  }
}
