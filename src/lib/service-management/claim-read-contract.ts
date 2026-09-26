import { z } from "zod";
import type { ClaimBatchSummary } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const countNumber = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const count = z.union([countNumber,
  z.string().regex(/^(?:0|[1-9]\d{0,15})$/u).transform(Number).pipe(countNumber)]);
// Matches the existing claim aggregate/validation contract, not financial
// reversals. A malformed draft aggregate must not enter the validation picker.
const moneyText = z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/u)
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    const cents = fraction.padEnd(2, "0");
    return `${whole}.${cents}`;
  });
const money = z.union([moneyText, z.number().finite().transform(String).pipe(moneyText)]);
const time = z.iso.datetime({ offset: true });
const row = z.object({
  id: uuid, claim_period_start: z.iso.date(), claim_period_end: z.iso.date(),
  // The stored text/RPC contract has no length cap. Do not invent a read-side
  // limit that makes every batch unavailable when a legacy version is longer.
  format_version: z.string().min(1)
    .refine((value) => value.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(value)),
  status: z.enum(["draft", "validated", "exported", "submitted", "accepted", "rejected", "reconciled", "voided"]),
  item_count: count, total_amount: money,
  responded_item_count: count, rejected_item_count: count,
  legacy_response_unknown: z.boolean(), has_immutable_snapshot: z.boolean(),
  exported_at: time.nullable(), submitted_at: time.nullable(), reconciled_at: time.nullable(),
  updated_at: time,
}).strict().refine((value) => value.claim_period_start <= value.claim_period_end &&
  value.rejected_item_count <= value.responded_item_count && value.responded_item_count <= value.item_count);
const rows = z.array(row).max(200).refine((value) => new Set(value.map((item) => item.id)).size === value.length);

/** Validate the existing RLS-filtered RPC shape. It does not return scope IDs;
 * this parser must not be described as a persisted scope receipt. */
export function parseClaimReadRows(raw: unknown): readonly ClaimBatchSummary[] {
  return rows.parse(raw).map((value) => ({
    id: value.id, periodStart: value.claim_period_start, periodEnd: value.claim_period_end,
    formatVersion: value.format_version, status: value.status, itemCount: value.item_count,
    totalAmount: value.total_amount, respondedItemCount: value.responded_item_count,
    rejectedItemCount: value.rejected_item_count, legacyResponseUnknown: value.legacy_response_unknown,
    hasImmutableSnapshot: value.has_immutable_snapshot, exportedAt: value.exported_at,
    submittedAt: value.submitted_at, reconciledAt: value.reconciled_at, updatedAt: value.updated_at,
  }));
}
