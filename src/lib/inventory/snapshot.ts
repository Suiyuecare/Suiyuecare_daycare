import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoInventoryManagementSnapshot } from "./demo";
import {
  projectInventoryManagementSnapshot,
  type InventorySnapshotSourceRow,
} from "./projection";
import type { InventoryFilters } from "./types";

export class InventoryManagementSnapshotError extends Error {
  constructor() {
    super("INVENTORY_MANAGEMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "InventoryManagementSnapshotError";
  }
}

export async function loadInventoryManagementSnapshot(
  context: TenantContext,
  filters: InventoryFilters,
) {
  if (context.demo) return buildDemoInventoryManagementSnapshot({
    organizationId: context.organizationId, branchId: context.branchId, filters,
  });
  if (context.assuranceLevel !== "aal2" || !context.scopes.includes("inventory.read")) {
    throw new InventoryManagementSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new InventoryManagementSnapshotError();
  const { data, error } = await supabase.rpc("inventory_management_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_item_id: filters.itemId,
    p_search: filters.query || null,
    p_batch_query: filters.batchQuery || null,
    p_expiry_status: filters.expiryStatus,
    p_movement_type: filters.movementType,
  }).maybeSingle<InventorySnapshotSourceRow>();
  if (error || !data) throw new InventoryManagementSnapshotError();
  try {
    return projectInventoryManagementSnapshot({
      row: data, expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, filters, demo: false,
    });
  } catch {
    throw new InventoryManagementSnapshotError();
  }
}
