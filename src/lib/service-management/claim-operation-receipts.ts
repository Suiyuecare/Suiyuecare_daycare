import { z } from "zod";
import { MAX_CLAIM_RECONCILIATION_ITEMS } from "@/lib/integrations/claims";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const moneyText = z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/u)
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    return `${whole}.${fraction.padEnd(2, "0")}`;
  });
const money = z.union([moneyText, z.number().finite().nonnegative().transform(String).pipe(moneyText)]);
const safeCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const count = z.union([safeCount,
  z.string().regex(/^(?:0|[1-9]\d{0,15})$/u).transform(Number).pipe(safeCount)]);
const itemCount = count.refine((value) => value > 0);
const expectedSchema = z.object({ claimBatchId: uuid, expectedTotalAmount: moneyText });
const exportReceipt = z.object({
  claim_batch_id: uuid,
  format_version: z.string().min(1).max(120)
    .refine((value) => value.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(value)),
  status: z.literal("exported"),
  snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  item_count: itemCount,
  total_amount: money,
  replayed: z.boolean(),
}).strict();
const reconciliationReceipt = z.object({
  claim_batch_id: uuid,
  status: z.literal("reconciled"),
  item_count: itemCount.refine((value) => value <= MAX_CLAIM_RECONCILIATION_ITEMS),
  accepted_count: count,
  rejected_count: count,
  total_amount: money,
  replayed: z.boolean(),
}).strict();
const reconciliationExpected = expectedSchema.extend({
  results: z.array(z.object({ claimItemId: uuid, outcome: z.enum(["accepted", "rejected"]) }))
    .min(1).max(MAX_CLAIM_RECONCILIATION_ITEMS),
});

export class ClaimOperationReceiptError extends Error {
  constructor() {
    super("申報回執尚未核對完成；請保留原批次、金額及操作鍵重試。");
    this.name = "ClaimOperationReceiptError";
  }
}

/** These existing RPCs return snapshot metadata, not an official submission file.
 * Scope, same-session authority and idempotency are enforced by the atomic RPC;
 * its current receipt does not expose persisted scope or request-hash evidence. */
export function parseClaimExportDatabaseReceipt(raw: unknown,
  expected: { claimBatchId: string; expectedTotalAmount: string }) {
  const parsed = exportReceipt.safeParse(raw);
  const input = expectedSchema.safeParse(expected);
  if (!parsed.success || !input.success ||
    parsed.data.claim_batch_id !== input.data.claimBatchId ||
    parsed.data.total_amount !== input.data.expectedTotalAmount) {
    throw new ClaimOperationReceiptError();
  }
  return parsed.data;
}

export function parseClaimReconciliationDatabaseReceipt(raw: unknown,
  expected: { claimBatchId: string; expectedTotalAmount: string;
    results: Array<{ claimItemId: string; outcome: "accepted" | "rejected" }> }) {
  const parsed = reconciliationReceipt.safeParse(raw);
  const input = reconciliationExpected.safeParse(expected);
  if (!parsed.success || !input.success) throw new ClaimOperationReceiptError();
  const accepted = input.data.results.filter((result) => result.outcome === "accepted").length;
  if (new Set(input.data.results.map((result) => result.claimItemId)).size !== input.data.results.length ||
    parsed.data.claim_batch_id !== input.data.claimBatchId ||
    parsed.data.total_amount !== input.data.expectedTotalAmount ||
    parsed.data.item_count !== input.data.results.length ||
    parsed.data.accepted_count !== accepted ||
    parsed.data.rejected_count !== input.data.results.length - accepted) {
    throw new ClaimOperationReceiptError();
  }
  return parsed.data;
}
