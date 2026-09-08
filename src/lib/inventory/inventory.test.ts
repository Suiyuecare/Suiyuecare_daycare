import { describe, expect, it } from "vitest";

import {
  inventoryDecimalEqual,
  inventoryDecimalToScaledInteger,
} from "./decimal";
import {
  parseInventoryItemApiEnvelope,
  parseInventoryItemInput,
  parseInventoryMovementApiEnvelope,
  parseInventoryMovementInput,
} from "./parser";
import {
  projectInventoryManagementSnapshot,
  type InventorySnapshotSourceRow,
} from "./projection";
import type { InventoryFilters } from "./types";

const ORG = "77000000-0000-4000-8000-000000000001";
const BRANCH = "77000000-0000-4000-8000-000000000002";
const ITEM = "77000000-0000-4000-8000-000000000003";
const BATCH = "77000000-0000-4000-8000-000000000004";
const MOVEMENT = "77000000-0000-4000-8000-000000000005";
const ACTOR = "77000000-0000-4000-8000-000000000006";
const KEY = "77000000-0000-4000-8000-000000000007";
const filters: InventoryFilters = {
  itemId: null, query: "", batchQuery: "", expiryStatus: "all", movementType: "all",
};

function sourceRow(): InventorySnapshotSourceRow {
  return {
    organization_id: ORG, branch_id: BRANCH,
    generated_at: "2026-09-01T10:30:00+08:00", snapshot_date: "2026-09-01",
    policy_status: "not_configured", policy_version: null,
    near_expiry_days: null, stocktake_cycle_days: null,
    item_options: [{ item_id: ITEM, item_code: "GLOVE", item_name: "手套", unit: "盒",
      status: "active", status_ledger_version: 1, total_balance: "5.0000",
      batch_count: 1, safety_quantity: null, is_low_stock: null,
      last_movement_at: "2026-09-01T09:00:00+08:00" }],
    item_total: 1, items_truncated: false,
    batches: [{ batch_id: BATCH, item_id: ITEM, item_code: "GLOVE", item_name: "手套",
      item_status: "active", item_status_ledger_version: 1,
      batch_number: "LOT-1", expiry_date: "2026-12-01", unit: "盒",
      balance: "5.0000", item_total_balance: "5.0000", ledger_version: 1,
      movement_count: 1, latest_movement_id: MOVEMENT, latest_movement_type: "receipt",
      latest_movement_occurred_at: "2026-09-01T09:00:00+08:00",
      last_stocktake_at: null, expiry_status: "valid", safety_quantity: null,
      is_low_stock: null, is_near_expiry: null, is_stocktake_due: null }],
    batch_total: 1, matching_batch_total: 1, matching_item_total: 1,
    batches_truncated: false,
    movement_history: [{ movement_id: MOVEMENT, item_id: ITEM, batch_id: BATCH,
      item_code: "GLOVE", item_name: "手套", batch_number: "LOT-1", unit: "盒",
      expiry_status: "valid", movement_type: "receipt", ledger_version: 1,
      quantity: "5.0000", quantity_delta: "5.0000", balance_after: "5.0000",
      occurred_at: "2026-09-01T09:00:00+08:00", original_movement_id: null,
      client_scope_visible: true, client_id: null, client_code: null,
      client_display_name: null, instruction_reference: null,
      issued_to_user_id: null, issued_to_display_name: null, purpose: null,
      destination_unit: null, reason: null, recorded_by: ACTOR,
      recorded_by_display_name: "主管", recorded_at: "2026-09-01T09:00:01+08:00" }],
    matching_movement_total: 1, movements_truncated: false,
    client_options: [], client_total: 0, clients_truncated: false,
    staff_options: [{ user_id: ACTOR, display_name: "主管", employee_code: "I-001" }],
    staff_total: 1, staff_truncated: false,
    returnable_issue_options: [], returnable_issue_total: 0,
    returnable_issues_truncated: false, low_stock_total: null,
    near_expiry_total: null, expired_batch_total: 0, stocktake_due_total: null,
    supplier_procurement: "not_implemented", medication_order_integration: "not_implemented",
    financial_automation: "not_implemented",
  };
}

describe("inventory projection and decimals", () => {
  it("projects one coherent frozen snapshot and preserves exact decimal strings", () => {
    const snapshot = projectInventoryManagementSnapshot({
      row: sourceRow(), expectedOrganizationId: ORG, expectedBranchId: BRANCH,
      filters, demo: false,
    });
    expect(snapshot.batches[0]?.balance).toBe("5.0000");
    expect(snapshot.movements[0]?.clientScopeVisible).toBe(true);
  });

  it("compares numeric(18,4) values as scaled integers without IEEE rounding", () => {
    expect(inventoryDecimalEqual("99999999999999.9999", "99999999999999.9999")).toBe(true);
    expect(inventoryDecimalEqual("99999999999999.9999", "99999999999999.9998")).toBe(false);
    expect(inventoryDecimalToScaledInteger("99999999999999.9999") -
      inventoryDecimalToScaledInteger("99999999999999.9998")).toBe(BigInt(1));
  });

  it.each([
    ["stale aggregate", (row: ReturnType<typeof sourceRow>) => { row.expired_batch_total = 1; }],
    ["bad tenant", (row: ReturnType<typeof sourceRow>) => { row.branch_id = ITEM; }],
    ["bad Taipei date", (row: ReturnType<typeof sourceRow>) => { row.snapshot_date = "2026-09-02"; }],
    ["future audit", (row: ReturnType<typeof sourceRow>) => {
      row.movement_history[0]!.recorded_at = "2026-09-01T10:31:00+08:00";
    }],
  ])("fails closed for %s", (_label, mutate) => {
    const row = sourceRow(); mutate(row);
    expect(() => projectInventoryManagementSnapshot({ row,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false }))
      .toThrow("INVALID_INVENTORY_MANAGEMENT_PROJECTION");
  });

  it("accepts an explicitly redacted client issue and rejects partial disclosure", () => {
    const row = sourceRow();
    row.movement_history[0] = { ...row.movement_history[0]!,
      movement_type: "client_issue", quantity: "1.0000", quantity_delta: "-1.0000",
      balance_after: "4.0000", client_scope_visible: false,
    };
    expect(projectInventoryManagementSnapshot({ row,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false })
      .movements[0]?.clientId).toBeNull();
    row.movement_history[0]!.client_id = ITEM;
    expect(() => projectInventoryManagementSnapshot({ row,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false }))
      .toThrow("INVALID_INVENTORY_MANAGEMENT_PROJECTION");
  });
});

describe("inventory input and strict receipt correlation", () => {
  const movementBody = {
    item_id: ITEM, batch_id: BATCH, new_batch_number: null,
    new_expiry_date: null, new_unit: null, movement_type: "issue",
    quantity: "99999999999999.9999", adjustment_delta: null,
    counted_quantity: null, original_movement_id: null, client_id: null,
    instruction_reference: null, issued_to_user_id: null,
    purpose: "照顧使用", destination_unit: "日照區", reason: null,
    occurred_at: "2026-09-01T09:00:00+08:00", expected_ledger_version: 1,
  };

  it("rejects impossible calendar dates and more than four decimal places", () => {
    expect(() => parseInventoryMovementInput({ ...movementBody, movement_type: "receipt",
      batch_id: null, new_batch_number: "LOT-2", new_expiry_date: "2026-02-31",
      new_unit: "盒", purpose: null, destination_unit: null, expected_ledger_version: 0,
    }, KEY)).toThrow("請完整填寫庫存異動");
    expect(() => parseInventoryMovementInput({ ...movementBody, quantity: "1.00001" }, KEY))
      .toThrow("請完整填寫庫存異動");
  });

  it("rejects a malicious 2xx receipt differing only beyond IEEE-safe precision", () => {
    const input = parseInventoryMovementInput(movementBody, KEY);
    const envelope = { requestId: KEY, status: "ok", data: { receipt: {
      organizationId: ORG, branchId: BRANCH, itemId: ITEM, batchId: BATCH,
      movementId: MOVEMENT, movementType: "issue", ledgerVersion: 2,
      quantity: "99999999999999.9998", quantityDelta: "-99999999999999.9998",
      balanceAfter: "0.0000", occurredAt: "2026-09-01T09:00:00+08:00",
      replayed: false, persisted: true, demo: false,
    }, persisted: true, demo: false }, errors: [] };
    expect(() => parseInventoryMovementApiEnvelope(envelope, input, ORG, BRANCH))
      .toThrow("庫存異動結果無法與送出內容核對");
  });

  it("accepts strict item receipt correlation and rejects primitive receipts", () => {
    const input = parseInventoryItemInput({ action: "create", item_code: "GLOVE",
      item_name: "手套", unit: "盒" }, KEY);
    const good = { requestId: KEY, status: "ok", data: { receipt: {
      itemId: ITEM, organizationId: ORG, branchId: BRANCH, itemCode: "GLOVE",
      unit: "盒", status: "active", statusLedgerVersion: 1,
      committedAt: "2026-09-01T09:00:00+08:00", replayed: false,
      persisted: true, demo: false,
    }, persisted: true, demo: false }, errors: [] };
    expect(parseInventoryItemApiEnvelope(good, input, ORG, BRANCH).receipt.itemId).toBe(ITEM);
    for (const receipt of [null, 7, { ...good.data.receipt, secret: "leak" }]) {
      expect(() => parseInventoryItemApiEnvelope({ ...good,
        data: { ...good.data, receipt } }, input, ORG, BRANCH)).toThrow();
    }
  });
});
