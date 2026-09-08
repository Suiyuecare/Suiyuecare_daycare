import { taipeiDate } from "./date";
import { projectInventoryManagementSnapshot } from "./projection";
import type { InventoryFilters } from "./types";

const ITEM = "77000000-0000-4000-8000-000000000001";
const BATCH = "77000000-0000-4000-8000-000000000002";
const MOVEMENT = "77000000-0000-4000-8000-000000000003";
const ACTOR = "77000000-0000-4000-8000-000000000004";

export function buildDemoInventoryManagementSnapshot(input: {
  organizationId: string;
  branchId: string;
  filters: InventoryFilters;
}) {
  const generatedAt = new Date().toISOString();
  const snapshotDate = taipeiDate(generatedAt);
  const expiry = new Date(`${snapshotDate}T00:00:00Z`);
  expiry.setUTCDate(expiry.getUTCDate() + 30);
  const expiryDate = expiry.toISOString().slice(0, 10);
  const search = input.filters.query.toLocaleLowerCase("zh-TW");
  const batchMatch = input.filters.itemId === null || input.filters.itemId === ITEM;
  const textMatch = !search || "demo-001 示範手套".includes(search);
  const numberMatch = !input.filters.batchQuery ||
    "DEMO-LOT".toLocaleLowerCase("zh-TW")
      .includes(input.filters.batchQuery.toLocaleLowerCase("zh-TW"));
  const expiryMatch = input.filters.expiryStatus === "all" ||
    input.filters.expiryStatus === "valid";
  const movementMatch = input.filters.movementType === "all" ||
    input.filters.movementType === "receipt";
  const visible = batchMatch && textMatch && numberMatch && expiryMatch && movementMatch;
  const movementVisible = visible && movementMatch;
  return projectInventoryManagementSnapshot({
    expectedOrganizationId: input.organizationId,
    expectedBranchId: input.branchId,
    filters: input.filters,
    demo: true,
    row: {
      organization_id: input.organizationId, branch_id: input.branchId,
      generated_at: generatedAt, snapshot_date: snapshotDate,
      policy_status: "not_configured", policy_version: null,
      near_expiry_days: null, stocktake_cycle_days: null,
      item_options: [{
        item_id: ITEM, item_code: "DEMO-001", item_name: "示範手套", unit: "盒",
        status: "active", status_ledger_version: 1, total_balance: "8.0000",
        batch_count: 1, safety_quantity: null, is_low_stock: null,
        last_movement_at: generatedAt,
      }], item_total: 1, items_truncated: false,
      batches: visible ? [{
        batch_id: BATCH, item_id: ITEM, item_code: "DEMO-001", item_name: "示範手套",
        item_status: "active", item_status_ledger_version: 1,
        batch_number: "DEMO-LOT", expiry_date: expiryDate, unit: "盒",
        balance: "8.0000", item_total_balance: "8.0000", ledger_version: 1,
        movement_count: 1, latest_movement_id: MOVEMENT,
        latest_movement_type: "receipt", latest_movement_occurred_at: generatedAt,
        last_stocktake_at: null, expiry_status: "valid", safety_quantity: null,
        is_low_stock: null, is_near_expiry: null, is_stocktake_due: null,
      }] : [], batch_total: 1, matching_batch_total: visible ? 1 : 0,
      matching_item_total: visible ? 1 : 0, batches_truncated: false,
      movement_history: movementVisible ? [{
        movement_id: MOVEMENT, item_id: ITEM, batch_id: BATCH,
        item_code: "DEMO-001", item_name: "示範手套", batch_number: "DEMO-LOT",
        unit: "盒", expiry_status: "valid", movement_type: "receipt",
        ledger_version: 1, quantity: "8.0000", quantity_delta: "8.0000",
        balance_after: "8.0000", occurred_at: generatedAt,
        original_movement_id: null, client_scope_visible: true,
        client_id: null, client_code: null,
        client_display_name: null, instruction_reference: null,
        issued_to_user_id: null, issued_to_display_name: null, purpose: null,
        destination_unit: null, reason: null, recorded_by: ACTOR,
        recorded_by_display_name: "示範主管", recorded_at: generatedAt,
      }] : [], matching_movement_total: movementVisible ? 1 : 0,
      movements_truncated: false, client_options: [], client_total: 0,
      clients_truncated: false, staff_options: [{
        user_id: ACTOR, display_name: "示範主管", employee_code: "D-001",
      }], staff_total: 1, staff_truncated: false,
      returnable_issue_options: [], returnable_issue_total: 0,
      returnable_issues_truncated: false, low_stock_total: null,
      near_expiry_total: null, expired_batch_total: 0, stocktake_due_total: null,
      supplier_procurement: "not_implemented",
      medication_order_integration: "not_implemented",
      financial_automation: "not_implemented",
    },
  });
}
