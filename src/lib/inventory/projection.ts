import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { isInventoryCalendarDate, taipeiDate } from "./date";
import { inventoryDecimalEqual, inventoryDecimalToScaledInteger } from "./decimal";
import {
  INVENTORY_MOVEMENT_TYPES,
  type InventoryFilters,
  type InventoryManagementSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const date = z.string().refine(isInventoryCalendarDate);
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);
const decimal = z.string().regex(/^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/u);
const nonNegativeDecimal = decimal.refine((value) => {
  try { return inventoryDecimalToScaledInteger(value) >= BigInt(0); }
  catch { return false; }
});
const text = (max: number) => z.string().trim().min(1).max(max);
const movementType = z.enum(INVENTORY_MOVEMENT_TYPES);
const expiryStatus = z.enum(["valid", "near_expiry", "expired"]);

const itemSchema = z.object({
  item_id: uuid, item_code: text(80), item_name: text(160), unit: text(40),
  status: z.enum(["active", "inactive"]),
  status_ledger_version: z.number().int().positive().safe(),
  total_balance: nonNegativeDecimal,
  batch_count: count,
  safety_quantity: nonNegativeDecimal.nullable(),
  is_low_stock: z.boolean().nullable(),
  last_movement_at: timestamp.nullable(),
}).strict();

const batchSchema = z.object({
  batch_id: uuid, item_id: uuid, item_code: text(80), item_name: text(160),
  item_status: z.enum(["active", "inactive"]),
  item_status_ledger_version: z.number().int().positive().safe(),
  batch_number: text(120), expiry_date: date, unit: text(40),
  balance: nonNegativeDecimal, item_total_balance: nonNegativeDecimal,
  ledger_version: count, movement_count: count,
  latest_movement_id: uuid.nullable(), latest_movement_type: movementType.nullable(),
  latest_movement_occurred_at: timestamp.nullable(),
  last_stocktake_at: timestamp.nullable(), expiry_status: expiryStatus,
  safety_quantity: nonNegativeDecimal.nullable(), is_low_stock: z.boolean().nullable(),
  is_near_expiry: z.boolean().nullable(), is_stocktake_due: z.boolean().nullable(),
}).strict();

const movementSchema = z.object({
  movement_id: uuid, item_id: uuid, batch_id: uuid,
  item_code: text(80), item_name: text(160), batch_number: text(120), unit: text(40),
  expiry_status: expiryStatus, movement_type: movementType,
  ledger_version: z.number().int().positive().safe(),
  quantity: nonNegativeDecimal, quantity_delta: decimal, balance_after: nonNegativeDecimal,
  occurred_at: timestamp, original_movement_id: uuid.nullable(),
  client_scope_visible: z.boolean(),
  client_id: uuid.nullable(), client_code: text(120).nullable(),
  client_display_name: text(120).nullable(), instruction_reference: text(500).nullable(),
  issued_to_user_id: uuid.nullable(), issued_to_display_name: text(120).nullable(),
  purpose: text(500).nullable(), destination_unit: text(160).nullable(),
  reason: text(1_000).nullable(), recorded_by: uuid,
  recorded_by_display_name: text(120), recorded_at: timestamp,
}).strict();

const clientSchema = z.object({
  client_id: uuid, client_code: text(120), display_name: text(120),
}).strict();
const staffSchema = z.object({
  user_id: uuid, display_name: text(120), employee_code: z.string().trim().max(120).nullable(),
}).strict();
const returnableSchema = z.object({
  original_movement_id: uuid, item_id: uuid, batch_id: uuid,
  movement_type: z.enum(["issue", "client_issue"]), occurred_at: timestamp,
  item_code: text(80), item_name: text(160), batch_number: text(120), unit: text(40),
  outstanding_quantity: nonNegativeDecimal.refine((value) => {
    try { return inventoryDecimalToScaledInteger(value) > BigInt(0); }
    catch { return false; }
  }),
  client_id: uuid.nullable(), client_code: text(120).nullable(),
  client_display_name: text(120).nullable(), instruction_reference: text(500).nullable(),
  purpose: text(500).nullable(), destination_unit: text(160).nullable(),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid, branch_id: uuid, generated_at: timestamp,
  snapshot_date: date, policy_status: z.enum(["not_configured", "published"]),
  policy_version: z.number().int().positive().safe().nullable(),
  near_expiry_days: z.number().int().min(0).max(3650).nullable(),
  stocktake_cycle_days: z.number().int().min(1).max(3650).nullable(),
  item_options: z.array(itemSchema).max(200), item_total: count, items_truncated: z.boolean(),
  batches: z.array(batchSchema).max(200), batch_total: count,
  matching_batch_total: count, matching_item_total: count, batches_truncated: z.boolean(),
  movement_history: z.array(movementSchema).max(200),
  matching_movement_total: count, movements_truncated: z.boolean(),
  client_options: z.array(clientSchema).max(200), client_total: count,
  clients_truncated: z.boolean(), staff_options: z.array(staffSchema).max(200),
  staff_total: count, staff_truncated: z.boolean(),
  returnable_issue_options: z.array(returnableSchema).max(200),
  returnable_issue_total: count, returnable_issues_truncated: z.boolean(),
  low_stock_total: count.nullable(), near_expiry_total: count.nullable(),
  expired_batch_total: count, stocktake_due_total: count.nullable(),
  supplier_procurement: z.literal("not_implemented"),
  medication_order_integration: z.literal("not_implemented"),
  financial_automation: z.literal("not_implemented"),
}).strict();

export type InventorySnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("INVALID_INVENTORY_MANAGEMENT_PROJECTION");
}
function unique(values: readonly string[]) {
  return values.length === new Set(values).size;
}
function totalInvariant(total: number, loaded: number, truncated: boolean) {
  return total >= loaded && truncated === (total > loaded) &&
    (truncated || total === loaded);
}

export function projectInventoryManagementSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: InventoryFilters;
  demo: boolean;
}): InventoryManagementSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== organization.data || row.branch_id !== branch.data ||
    taipeiDate(row.generated_at) !== row.snapshot_date ||
    !totalInvariant(row.item_total, row.item_options.length, row.items_truncated) ||
    !totalInvariant(row.matching_batch_total, row.batches.length, row.batches_truncated) ||
    !totalInvariant(row.matching_movement_total, row.movement_history.length, row.movements_truncated) ||
    !totalInvariant(row.client_total, row.client_options.length, row.clients_truncated) ||
    !totalInvariant(row.staff_total, row.staff_options.length, row.staff_truncated) ||
    !totalInvariant(row.returnable_issue_total, row.returnable_issue_options.length,
      row.returnable_issues_truncated) ||
    row.matching_batch_total > row.batch_total || row.matching_item_total > row.item_total ||
    !unique(row.item_options.map((item) => item.item_id)) ||
    !unique(row.batches.map((batch) => batch.batch_id)) ||
    !unique(row.movement_history.map((movement) => movement.movement_id)) ||
    !unique(row.client_options.map((client) => client.client_id)) ||
    !unique(row.staff_options.map((staff) => staff.user_id)) ||
    !unique(row.returnable_issue_options.map((movement) => movement.original_movement_id))) {
    invalid();
  }
  if (row.policy_status === "not_configured") {
    if (row.policy_version !== null || row.near_expiry_days !== null ||
      row.stocktake_cycle_days !== null || row.low_stock_total !== null ||
      row.near_expiry_total !== null || row.stocktake_due_total !== null) invalid();
  } else if (row.policy_version === null || row.near_expiry_days === null ||
    row.stocktake_cycle_days === null || row.low_stock_total === null ||
    row.near_expiry_total === null || row.stocktake_due_total === null) invalid();

  const itemMap = new Map(row.item_options.map((item) => [item.item_id, item]));
  for (const batch of row.batches) {
    const item = itemMap.get(batch.item_id);
    const objectivelyExpired = batch.expiry_date < row.snapshot_date;
    if ((objectivelyExpired && batch.expiry_status !== "expired") ||
      (!objectivelyExpired && batch.expiry_status === "expired") ||
      (row.policy_status === "not_configured" && (
        batch.expiry_status === "near_expiry" || batch.safety_quantity !== null ||
        batch.is_low_stock !== null || batch.is_near_expiry !== null ||
        batch.is_stocktake_due !== null
      )) || (item && (item.item_code !== batch.item_code || item.item_name !== batch.item_name ||
        item.unit !== batch.unit || item.status !== batch.item_status ||
        item.status_ledger_version !== batch.item_status_ledger_version ||
        !inventoryDecimalEqual(item.total_balance, batch.item_total_balance))) ||
      (batch.ledger_version === 0) !== (batch.movement_count === 0) ||
      (batch.latest_movement_id === null) !== (batch.ledger_version === 0) ||
      (batch.latest_movement_type === null) !== (batch.ledger_version === 0) ||
      (batch.latest_movement_occurred_at === null) !== (batch.ledger_version === 0)) invalid();
    const search = input.filters.query.toLocaleLowerCase("zh-TW");
    if ((input.filters.itemId !== null && batch.item_id !== input.filters.itemId) ||
      (search && !`${batch.item_code} ${batch.item_name}`.toLocaleLowerCase("zh-TW").includes(search)) ||
      (input.filters.batchQuery && !batch.batch_number.toLocaleLowerCase("zh-TW")
        .includes(input.filters.batchQuery.toLocaleLowerCase("zh-TW"))) ||
      (input.filters.expiryStatus !== "all" && batch.expiry_status !== input.filters.expiryStatus)) invalid();
  }

  let previousOccurredAt: string | null = null;
  for (const movement of row.movement_history) {
    const quantity = inventoryDecimalToScaledInteger(movement.quantity);
    const delta = inventoryDecimalToScaledInteger(movement.quantity_delta);
    const balance = inventoryDecimalToScaledInteger(movement.balance_after);
    if (balance < BigInt(0) || (previousOccurredAt !== null && movement.occurred_at > previousOccurredAt) ||
      Date.parse(movement.recorded_at) > Date.parse(row.generated_at) ||
      Date.parse(movement.occurred_at) > Date.parse(row.generated_at) + 60_000 ||
      (input.filters.movementType !== "all" && movement.movement_type !== input.filters.movementType) ||
      (movement.movement_type === "receipt" && delta !== quantity) ||
      (movement.movement_type === "issue" && (delta !== -quantity || !movement.purpose || !movement.destination_unit)) ||
      (movement.movement_type === "client_issue" && (delta !== -quantity ||
        (movement.client_scope_visible && (!movement.client_id ||
          !movement.instruction_reference || !movement.issued_to_user_id)) ||
        (!movement.client_scope_visible && (movement.client_id !== null ||
          movement.client_code !== null || movement.client_display_name !== null ||
          movement.instruction_reference !== null || movement.issued_to_user_id !== null ||
          movement.issued_to_display_name !== null)))) ||
      (movement.movement_type === "return" && (delta !== quantity || !movement.original_movement_id || !movement.reason)) ||
      (movement.movement_type === "adjustment" && (
        (delta < BigInt(0) ? -delta : delta) !== quantity ||
          delta === BigInt(0) || !movement.reason
      )) ||
      (movement.movement_type === "stocktake" && (balance !== quantity || !movement.reason))) invalid();
    previousOccurredAt = movement.occurred_at;
  }

  if (!row.batches_truncated) {
    const positive = row.batches.filter((batch) =>
      inventoryDecimalToScaledInteger(batch.balance) > BigInt(0));
    if (row.expired_batch_total !== positive.filter((batch) => batch.expiry_status === "expired").length ||
      (row.policy_status === "published" && (
        row.near_expiry_total !== positive.filter((batch) => batch.is_near_expiry).length ||
        row.stocktake_due_total !== positive.filter((batch) => batch.is_stocktake_due).length ||
        row.low_stock_total !== new Set(row.batches.filter((batch) => batch.is_low_stock)
          .map((batch) => batch.item_id)).size
      ))) invalid();
  }

  return {
    organizationId: row.organization_id, branchId: row.branch_id,
    generatedAt: row.generated_at, snapshotDate: row.snapshot_date,
    staleAfter: new Date(Date.parse(row.generated_at) + 60_000).toISOString(),
    filters: input.filters,
    policyStatus: row.policy_status, policyVersion: row.policy_version,
    nearExpiryDays: row.near_expiry_days, stocktakeCycleDays: row.stocktake_cycle_days,
    itemOptions: row.item_options.map((item) => ({
      itemId: item.item_id, itemCode: item.item_code, itemName: item.item_name,
      unit: item.unit, status: item.status, statusLedgerVersion: item.status_ledger_version,
      totalBalance: item.total_balance, batchCount: item.batch_count,
      safetyQuantity: item.safety_quantity, isLowStock: item.is_low_stock,
      lastMovementAt: item.last_movement_at,
    })), itemTotal: row.item_total, itemsTruncated: row.items_truncated,
    batches: row.batches.map((batch) => ({
      batchId: batch.batch_id, itemId: batch.item_id, itemCode: batch.item_code,
      itemName: batch.item_name, itemStatus: batch.item_status,
      itemStatusLedgerVersion: batch.item_status_ledger_version,
      batchNumber: batch.batch_number, expiryDate: batch.expiry_date, unit: batch.unit,
      balance: batch.balance, itemTotalBalance: batch.item_total_balance,
      ledgerVersion: batch.ledger_version, movementCount: batch.movement_count,
      latestMovementId: batch.latest_movement_id,
      latestMovementType: batch.latest_movement_type,
      latestMovementOccurredAt: batch.latest_movement_occurred_at,
      lastStocktakeAt: batch.last_stocktake_at, expiryStatus: batch.expiry_status,
      safetyQuantity: batch.safety_quantity, isLowStock: batch.is_low_stock,
      isNearExpiry: batch.is_near_expiry, isStocktakeDue: batch.is_stocktake_due,
    })), batchTotal: row.batch_total, matchingBatchTotal: row.matching_batch_total,
    matchingItemTotal: row.matching_item_total, batchesTruncated: row.batches_truncated,
    movements: row.movement_history.map((movement) => ({
      movementId: movement.movement_id, itemId: movement.item_id,
      batchId: movement.batch_id, itemCode: movement.item_code,
      itemName: movement.item_name, batchNumber: movement.batch_number, unit: movement.unit,
      expiryStatus: movement.expiry_status, movementType: movement.movement_type,
      ledgerVersion: movement.ledger_version, quantity: movement.quantity,
      quantityDelta: movement.quantity_delta, balanceAfter: movement.balance_after,
      occurredAt: movement.occurred_at, originalMovementId: movement.original_movement_id,
      clientScopeVisible: movement.client_scope_visible,
      clientId: movement.client_id, clientCode: movement.client_code,
      clientDisplayName: movement.client_display_name,
      instructionReference: movement.instruction_reference,
      issuedToUserId: movement.issued_to_user_id,
      issuedToDisplayName: movement.issued_to_display_name,
      purpose: movement.purpose, destinationUnit: movement.destination_unit,
      reason: movement.reason, recordedBy: movement.recorded_by,
      recordedByDisplayName: movement.recorded_by_display_name,
      recordedAt: movement.recorded_at,
    })), matchingMovementTotal: row.matching_movement_total,
    movementsTruncated: row.movements_truncated,
    clientOptions: row.client_options.map((client) => ({
      clientId: client.client_id, clientCode: client.client_code,
      displayName: client.display_name,
    })), clientTotal: row.client_total, clientsTruncated: row.clients_truncated,
    staffOptions: row.staff_options.map((staff) => ({
      userId: staff.user_id, displayName: staff.display_name,
      employeeCode: staff.employee_code,
    })), staffTotal: row.staff_total, staffTruncated: row.staff_truncated,
    returnableIssueOptions: row.returnable_issue_options.map((movement) => ({
      originalMovementId: movement.original_movement_id, itemId: movement.item_id,
      batchId: movement.batch_id, movementType: movement.movement_type,
      occurredAt: movement.occurred_at, itemCode: movement.item_code,
      itemName: movement.item_name, batchNumber: movement.batch_number,
      unit: movement.unit, outstandingQuantity: movement.outstanding_quantity,
      clientId: movement.client_id, clientCode: movement.client_code,
      clientDisplayName: movement.client_display_name,
      instructionReference: movement.instruction_reference,
      purpose: movement.purpose, destinationUnit: movement.destination_unit,
    })), returnableIssueTotal: row.returnable_issue_total,
    returnableIssuesTruncated: row.returnable_issues_truncated,
    lowStockTotal: row.low_stock_total, nearExpiryTotal: row.near_expiry_total,
    expiredBatchTotal: row.expired_batch_total,
    stocktakeDueTotal: row.stocktake_due_total,
    supplierProcurement: row.supplier_procurement,
    medicationOrderIntegration: row.medication_order_integration,
    financialAutomation: row.financial_automation,
    demo: input.demo,
  };
}
