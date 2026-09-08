import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import { isInventoryCalendarDate } from "./date";
import {
  inventoryDecimalEqual,
  inventoryDecimalToScaledInteger,
  inventoryScaledIntegerToDecimal,
} from "./decimal";
import {
  INVENTORY_MOVEMENT_TYPES,
  type InventoryItemInput,
  type InventoryItemReceipt,
  type InventoryMovementInput,
  type InventoryMovementReceipt,
} from "./types";

export const INVENTORY_ITEM_MAX_BYTES = 16 * 1024;
export const INVENTORY_MOVEMENT_MAX_BYTES = 48 * 1024;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const calendarDate = z.string().refine(isInventoryCalendarDate);
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const decimal = z.string().trim().regex(/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/u);
const positiveDecimal = decimal.refine((value) => {
  try { return inventoryDecimalToScaledInteger(value) > BigInt(0); }
  catch { return false; }
});
const signedDecimal = z.string().trim()
  .regex(/^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/u)
  .refine((value) => {
    try { return inventoryDecimalToScaledInteger(value) !== BigInt(0); }
    catch { return false; }
  });

const itemInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"), item_code: clean(80), item_name: clean(160), unit: clean(40),
  }).strict(),
  z.object({
    action: z.literal("set_status"), item_id: uuid,
    status: z.enum(["active", "inactive"]), reason: clean(1_000, true),
    expected_status_ledger_version: z.number().int().positive().safe(),
  }).strict(),
]);

const movementInputSchema = z.object({
  item_id: uuid, batch_id: uuid.nullable(), new_batch_number: clean(120).nullable(),
  new_expiry_date: calendarDate.nullable(), new_unit: clean(40).nullable(),
  movement_type: z.enum(INVENTORY_MOVEMENT_TYPES),
  quantity: positiveDecimal.nullable(), adjustment_delta: signedDecimal.nullable(),
  counted_quantity: decimal.nullable(), original_movement_id: uuid.nullable(),
  client_id: uuid.nullable(), instruction_reference: clean(500, true).nullable(),
  issued_to_user_id: uuid.nullable(), purpose: clean(500, true).nullable(),
  destination_unit: clean(160).nullable(), reason: clean(1_000, true).nullable(),
  occurred_at: timestamp, expected_ledger_version: z.number().int().nonnegative().safe(),
}).strict();

const itemReceiptSchema = z.object({
  item_id: uuid, organization_id: uuid, branch_id: uuid,
  item_code: clean(80), unit: clean(40), status: z.enum(["active", "inactive"]),
  status_ledger_version: z.number().int().positive().safe(),
  committed_at: timestamp, replayed: z.boolean(),
}).strict();
const movementReceiptSchema = z.object({
  organization_id: uuid, branch_id: uuid, item_id: uuid, batch_id: uuid,
  movement_id: uuid, movement_type: z.enum(INVENTORY_MOVEMENT_TYPES),
  ledger_version: z.number().int().positive().safe(), quantity: decimal,
  quantity_delta: z.string().regex(/^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/u),
  balance_after: decimal, occurred_at: timestamp, replayed: z.boolean(),
}).strict();

const itemApiReceiptSchema = z.object({
  itemId: uuid, organizationId: uuid, branchId: uuid, itemCode: clean(80),
  unit: clean(40), status: z.enum(["active", "inactive"]),
  statusLedgerVersion: z.number().int().positive().safe(), committedAt: timestamp,
  replayed: z.boolean(), persisted: z.literal(true), demo: z.literal(false),
}).strict();
const movementApiReceiptSchema = z.object({
  organizationId: uuid, branchId: uuid, itemId: uuid, batchId: uuid,
  movementId: uuid, movementType: z.enum(INVENTORY_MOVEMENT_TYPES),
  ledgerVersion: z.number().int().positive().safe(), quantity: decimal,
  quantityDelta: z.string().regex(/^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/u),
  balanceAfter: decimal, occurredAt: timestamp, replayed: z.boolean(),
  persisted: z.literal(true), demo: z.literal(false),
}).strict();
const envelope = z.object({
  requestId: uuid, status: z.literal("ok"), data: z.unknown(),
  errors: z.array(z.never()).length(0),
}).strict();

function invalid(code: string, message: string): never {
  throw new IntegrationError(code, message, 400);
}
function uncertain(message: string): never {
  throw new IntegrationError("INVENTORY_RECEIPT_INVALID", message, 409);
}

export function parseInventoryItemInput(
  value: unknown,
  idempotencyHeader: string | null,
): InventoryItemInput {
  const key = uuid.safeParse(idempotencyHeader);
  const parsed = itemInputSchema.safeParse(value);
  if (!key.success || !parsed.success) invalid(
    "INVALID_INVENTORY_ITEM", "請完整填寫品項資料並使用有效操作鍵。",
  );
  if (parsed.data.action === "create") return {
    action: "create", itemCode: parsed.data.item_code,
    itemName: parsed.data.item_name, unit: parsed.data.unit,
    idempotencyKey: key.data,
  };
  return {
    action: "set_status", itemId: parsed.data.item_id,
    status: parsed.data.status, reason: parsed.data.reason,
    expectedStatusLedgerVersion: parsed.data.expected_status_ledger_version,
    idempotencyKey: key.data,
  };
}

export function parseInventoryMovementInput(
  value: unknown,
  idempotencyHeader: string | null,
): InventoryMovementInput {
  const key = uuid.safeParse(idempotencyHeader);
  const parsed = movementInputSchema.safeParse(value);
  if (!key.success || !parsed.success) invalid(
    "INVALID_INVENTORY_MOVEMENT", "請完整填寫庫存異動並使用有效操作鍵。",
  );
  const body = parsed.data;
  const newBatch = body.batch_id === null;
  if (newBatch !== (body.new_batch_number !== null && body.new_expiry_date !== null &&
    body.new_unit !== null) || (!newBatch && (body.new_batch_number !== null ||
    body.new_expiry_date !== null || body.new_unit !== null)) ||
    (newBatch && (body.movement_type !== "receipt" || body.expected_ledger_version !== 0)) ||
    Date.parse(body.occurred_at) > Date.now() + 60_000) invalid(
    "INVALID_INVENTORY_MOVEMENT", "批次、發生時間或庫存版本不符合規則。",
  );
  const routine = ["receipt", "issue", "return", "client_issue"].includes(body.movement_type);
  if ((routine && (body.quantity === null || body.adjustment_delta !== null ||
      body.counted_quantity !== null)) ||
    (body.movement_type === "adjustment" && (body.quantity !== null ||
      body.adjustment_delta === null || body.counted_quantity !== null || body.reason === null)) ||
    (body.movement_type === "stocktake" && (body.quantity !== null ||
      body.adjustment_delta !== null || body.counted_quantity === null || body.reason === null)) ||
    (body.movement_type === "issue" && (!body.purpose || !body.destination_unit)) ||
    (body.movement_type === "client_issue" && (!body.client_id ||
      !body.instruction_reference || !body.issued_to_user_id)) ||
    (body.movement_type === "return" && (!body.original_movement_id || !body.reason)) ||
    (body.movement_type !== "issue" && (body.purpose !== null || body.destination_unit !== null)) ||
    (body.movement_type !== "client_issue" && (body.client_id !== null ||
      body.instruction_reference !== null || body.issued_to_user_id !== null)) ||
    (body.movement_type !== "return" && body.original_movement_id !== null) ||
    (!["return", "adjustment", "stocktake"].includes(body.movement_type) && body.reason !== null)) {
    invalid("INVALID_INVENTORY_MOVEMENT", "異動類型與數量、用途或追溯欄位不一致。");
  }
  return {
    itemId: body.item_id, batchId: body.batch_id,
    newBatchNumber: body.new_batch_number, newExpiryDate: body.new_expiry_date,
    newUnit: body.new_unit, movementType: body.movement_type,
    quantity: body.quantity, adjustmentDelta: body.adjustment_delta,
    countedQuantity: body.counted_quantity,
    originalMovementId: body.original_movement_id, clientId: body.client_id,
    instructionReference: body.instruction_reference,
    issuedToUserId: body.issued_to_user_id, purpose: body.purpose,
    destinationUnit: body.destination_unit, reason: body.reason,
    occurredAt: body.occurred_at, expectedLedgerVersion: body.expected_ledger_version,
    idempotencyKey: key.data,
  };
}

export function parseInventoryItemReceipt(value: unknown, input: InventoryItemInput,
  expectedOrganizationId: string, expectedBranchId: string): InventoryItemReceipt {
  const parsed = itemReceiptSchema.safeParse(value);
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId ||
    (input.action === "create" && (parsed.data.item_code !== input.itemCode ||
      parsed.data.unit !== input.unit || parsed.data.status !== "active" ||
      parsed.data.status_ledger_version !== 1)) ||
    (input.action === "set_status" && (parsed.data.item_id !== input.itemId ||
      parsed.data.status !== input.status ||
      parsed.data.status_ledger_version !== input.expectedStatusLedgerVersion + 1))) {
    uncertain("品項保存結果無法與送出內容核對；請保留相同操作鍵重試。");
  }
  return {
    itemId: parsed.data.item_id, organizationId: parsed.data.organization_id,
    branchId: parsed.data.branch_id, itemCode: parsed.data.item_code,
    unit: parsed.data.unit, status: parsed.data.status,
    statusLedgerVersion: parsed.data.status_ledger_version,
    committedAt: parsed.data.committed_at, replayed: parsed.data.replayed,
    persisted: true, demo: false,
  };
}

export function parseInventoryMovementReceipt(value: unknown,
  input: InventoryMovementInput, expectedOrganizationId: string,
  expectedBranchId: string): InventoryMovementReceipt {
  const parsed = movementReceiptSchema.safeParse(value);
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId || parsed.data.item_id !== input.itemId ||
    (input.batchId !== null && parsed.data.batch_id !== input.batchId) ||
    parsed.data.movement_type !== input.movementType ||
    parsed.data.ledger_version !== input.expectedLedgerVersion + 1 ||
    parsed.data.occurred_at !== input.occurredAt ||
    (input.quantity !== null && !inventoryDecimalEqual(parsed.data.quantity, input.quantity)) ||
    (input.adjustmentDelta !== null && (!inventoryDecimalEqual(
      parsed.data.quantity_delta, input.adjustmentDelta,
    ) || !inventoryDecimalEqual(
      parsed.data.quantity,
      inventoryScaledIntegerToDecimal((() => {
        const value = inventoryDecimalToScaledInteger(input.adjustmentDelta);
        return value < BigInt(0) ? -value : value;
      })()),
    ))) ||
    (input.countedQuantity !== null && (!inventoryDecimalEqual(
      parsed.data.quantity, input.countedQuantity,
    ) || !inventoryDecimalEqual(parsed.data.balance_after, input.countedQuantity))) ||
    (["receipt", "return"].includes(input.movementType) &&
      !inventoryDecimalEqual(parsed.data.quantity_delta, parsed.data.quantity)) ||
    (["issue", "client_issue"].includes(input.movementType) &&
      !inventoryDecimalEqual(
        parsed.data.quantity_delta,
        inventoryScaledIntegerToDecimal(-inventoryDecimalToScaledInteger(parsed.data.quantity)),
      ))) {
    uncertain("庫存異動結果無法與送出內容核對；請保留相同操作鍵重試。");
  }
  return {
    organizationId: parsed.data.organization_id, branchId: parsed.data.branch_id,
    itemId: parsed.data.item_id, batchId: parsed.data.batch_id,
    movementId: parsed.data.movement_id, movementType: parsed.data.movement_type,
    ledgerVersion: parsed.data.ledger_version, quantity: parsed.data.quantity,
    quantityDelta: parsed.data.quantity_delta, balanceAfter: parsed.data.balance_after,
    occurredAt: parsed.data.occurred_at, replayed: parsed.data.replayed,
    persisted: true, demo: false,
  };
}

export function parseInventoryItemApiEnvelope(value: unknown, input: InventoryItemInput,
  expectedOrganizationId: string, expectedBranchId: string) {
  const parsed = envelope.safeParse(value);
  if (!parsed.success) uncertain("品項保存回應格式不完整。");
  const data = z.object({ receipt: itemApiReceiptSchema, persisted: z.literal(true),
    demo: z.literal(false) }).strict().safeParse(parsed.data.data);
  if (!data.success) uncertain("品項保存回應未確認寫入。");
  return { requestId: parsed.data.requestId, receipt: parseInventoryItemReceipt({
    item_id: data.data.receipt.itemId, organization_id: data.data.receipt.organizationId,
    branch_id: data.data.receipt.branchId, item_code: data.data.receipt.itemCode,
    unit: data.data.receipt.unit, status: data.data.receipt.status,
    status_ledger_version: data.data.receipt.statusLedgerVersion,
    committed_at: data.data.receipt.committedAt, replayed: data.data.receipt.replayed,
  }, input, expectedOrganizationId, expectedBranchId) };
}

export function parseInventoryMovementApiEnvelope(value: unknown,
  input: InventoryMovementInput, expectedOrganizationId: string,
  expectedBranchId: string) {
  const parsed = envelope.safeParse(value);
  if (!parsed.success) uncertain("庫存異動回應格式不完整。");
  const data = z.object({ receipt: movementApiReceiptSchema, persisted: z.literal(true),
    demo: z.literal(false) }).strict().safeParse(parsed.data.data);
  if (!data.success) uncertain("庫存異動回應未確認寫入。");
  return { requestId: parsed.data.requestId, receipt: parseInventoryMovementReceipt({
    organization_id: data.data.receipt.organizationId,
    branch_id: data.data.receipt.branchId, item_id: data.data.receipt.itemId,
    batch_id: data.data.receipt.batchId, movement_id: data.data.receipt.movementId,
    movement_type: data.data.receipt.movementType,
    ledger_version: data.data.receipt.ledgerVersion, quantity: data.data.receipt.quantity,
    quantity_delta: data.data.receipt.quantityDelta,
    balance_after: data.data.receipt.balanceAfter,
    occurred_at: data.data.receipt.occurredAt, replayed: data.data.receipt.replayed,
  }, input, expectedOrganizationId, expectedBranchId) };
}
