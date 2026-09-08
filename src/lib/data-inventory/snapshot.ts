import "server-only";
import type { TenantContext } from "@/lib/domain/types";
import { isSyntheticReadMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { buildDemoDataInventorySnapshot } from "./demo";
import { projectDataInventorySnapshot } from "./parser";
import type { DataInventorySnapshot } from "./types";

export async function loadDataInventorySnapshot(context: TenantContext): Promise<DataInventorySnapshot> {
  if (!context.branchId ||
    !context.roles.some((r) => r === "organization_manager" || r === "branch_supervisor")) throw new Error("DATA_INVENTORY_NOT_AUTHORIZED");
  if (context.demo || isSyntheticReadMode()) return buildDemoDataInventorySnapshot(context.organizationId, context.branchId);
  if (context.assuranceLevel !== "aal2" || !context.scopes.includes("audit.view")) throw new Error("DATA_INVENTORY_NOT_AUTHORIZED");
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new Error("DATA_INVENTORY_NOT_CONFIGURED");
  const { data, error } = await supabase.rpc("data_inventory_snapshot", { p_expected_organization_id: context.organizationId, p_expected_branch_id: context.branchId });
  if (error || !data) throw new Error("DATA_INVENTORY_UNAVAILABLE");
  return projectDataInventorySnapshot(data, context.organizationId, context.branchId);
}
