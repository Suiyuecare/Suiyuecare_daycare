import { z } from "zod";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const money = z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/u)
  .transform((value) => { const [whole, fraction = ""] = value.split(".");
    return `${whole}.${fraction.padEnd(2, "0")}`; });
const count = z.number().int().min(1).max(5_000);
const expectedSchema = z.object({ claimBatchId: uuid, totalAmount: money,
  itemCount: count, demo: z.boolean(), idempotencyKey: uuid }).strict();
const persisted = z.object({ claimBatchId: uuid, totalAmount: money,
  itemCount: count, status: z.literal("validated"), replayed: z.boolean(),
  persisted: z.literal(true), demo: z.literal(false), idempotencyKey: uuid }).strict();
const demo = z.object({ claimBatchId: uuid, totalAmount: money,
  itemCount: z.null(), status: z.literal("draft"), replayed: z.literal(false),
  persisted: z.literal(false), demo: z.literal(true), idempotencyKey: uuid }).strict();
const success = z.object({ requestId: uuid, status: z.literal("ok"),
  data: z.discriminatedUnion("demo", [persisted, demo]), errors: z.array(z.never()).length(0) }).strict();
const databaseReceipt = z.object({ claim_batch_id: uuid, status: z.literal("validated"),
  organization_id: uuid, branch_id: uuid, idempotency_key: uuid,
  request_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  item_count: z.union([count, z.string().regex(/^[1-9]\d{0,3}$/u).transform(Number).pipe(count)]),
  total_amount: z.union([money, z.number().finite().nonnegative().transform(String).pipe(money)]),
  replayed: z.boolean() }).strict();

export type ClaimValidationExpected = z.input<typeof expectedSchema>;
export class ClaimValidationReceiptError extends Error {
  constructor() { super("申報驗證回覆尚未核對完成；請保留原批次、金額及操作鍵重試。");
    this.name = "ClaimValidationReceiptError"; }
}

export function parseClaimValidationDatabaseReceipt(raw: unknown,
  expected: { claimBatchId: string; expectedTotalAmount: string;
    expectedItemCount: number;
    organizationId: string; branchId: string; databaseIdempotencyKey: string }) {
  const parsed = databaseReceipt.safeParse(raw);
  const batch = uuid.safeParse(expected.claimBatchId);
  const amount = money.safeParse(expected.expectedTotalAmount);
  const items = count.safeParse(expected.expectedItemCount);
  const scope = z.object({ organizationId: uuid, branchId: uuid, databaseIdempotencyKey: uuid }).safeParse(expected);
  if (!parsed.success || !batch.success || !amount.success || !items.success || !scope.success ||
    parsed.data.organization_id !== scope.data.organizationId || parsed.data.branch_id !== scope.data.branchId ||
    parsed.data.idempotency_key !== scope.data.databaseIdempotencyKey ||
    parsed.data.claim_batch_id !== batch.data || parsed.data.total_amount !== amount.data ||
    parsed.data.item_count !== items.data) {
    throw new ClaimValidationReceiptError();
  }
  return parsed.data;
}

export function parseClaimValidationEnvelope(raw: unknown, httpStatus: number,
  expected: ClaimValidationExpected) {
  const parsed = success.safeParse(raw); const input = expectedSchema.safeParse(expected);
  if (!parsed.success || !input.success || httpStatus !== 200) throw new ClaimValidationReceiptError();
  const data = parsed.data.data;
  if (data.claimBatchId !== input.data.claimBatchId || data.totalAmount !== input.data.totalAmount ||
    data.demo !== input.data.demo || data.idempotencyKey !== input.data.idempotencyKey ||
    (!data.demo && data.itemCount !== input.data.itemCount)) throw new ClaimValidationReceiptError();
  return parsed.data;
}

export function isConfirmedClaimValidationRejection(raw: unknown, httpStatus: number) {
  const envelope = z.object({ requestId: uuid, status: z.literal("error"), data: z.null(),
    errors: z.array(z.object({ code: z.string(), message: z.string().max(500),
      field: z.string().max(120).optional() }).strict()).min(1).max(20) }).strict().safeParse(raw);
  const allowed: Record<number, string[]> = {
    400: ["INVALID_CLAIM_VALIDATION", "INVALID_JSON", "INVALID_IDEMPOTENCY_KEY"],
    401: ["AUTH_REQUIRED"], 403: ["AAL2_REQUIRED", "CLAIM_VALIDATION_NOT_AUTHORIZED"],
    409: ["CLAIM_VALIDATION_IDEMPOTENCY_CONFLICT", "CLAIM_VALIDATION_ALREADY_COMPLETED"],
    413: ["REQUEST_TOO_LARGE"], 422: ["CLAIM_VALIDATION_REJECTED"],
    503: ["SERVICE_NOT_CONFIGURED"],
  };
  return envelope.success && envelope.data.errors.every((error) => allowed[httpStatus]?.includes(error.code));
}
