import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoInsulinAdministrationSnapshot } from "./demo";
import {
  projectInsulinAdministrationSnapshot,
  type InsulinAdministrationSnapshotSource,
} from "./projection";
import type { InsulinFilters } from "./types";

export class InsulinAdministrationSnapshotError extends Error {
  constructor() {
    super("INSULIN_ADMINISTRATION_SNAPSHOT_UNAVAILABLE");
    this.name = "InsulinAdministrationSnapshotError";
  }
}

export async function loadInsulinAdministrationSnapshot(
  context: TenantContext,
  filters: InsulinFilters,
  recentAal2: boolean,
) {
  if (context.demo) return buildDemoInsulinAdministrationSnapshot(filters);
  if (!context.scopes.includes("clients.read") ||
      !context.scopes.includes("medications.read") ||
      !context.scopes.includes("insulin_administrations.read")) {
    throw new InsulinAdministrationSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new InsulinAdministrationSnapshotError();
  try {
    const { data, error } = await supabase.rpc("insulin_administration_snapshot", {
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
      p_service_date: filters.serviceDate,
      p_shift: filters.shift,
      p_client_id: filters.clientId,
      p_status: filters.state,
    }).maybeSingle();
    if (error || !data) throw new InsulinAdministrationSnapshotError();
    const snapshot = projectInsulinAdministrationSnapshot(
      data as InsulinAdministrationSnapshotSource,
    );
    const expectedExecute = recentAal2 &&
      context.scopes.includes("insulin_administrations.execute");
    const expectedReview = recentAal2 &&
      context.scopes.includes("insulin_administrations.verify");
    const expectedAuthorize = recentAal2 &&
      context.scopes.includes("insulin_administrations.authorize_late");
    if (snapshot.organizationId !== context.organizationId.toLowerCase() ||
        snapshot.branchId !== context.branchId.toLowerCase() ||
        snapshot.serviceDate !== filters.serviceDate ||
        (snapshot.canExecute && !expectedExecute) ||
        (snapshot.canReview && !expectedReview) ||
        (snapshot.canAuthorizeLate && !expectedAuthorize)) {
      throw new InsulinAdministrationSnapshotError();
    }
    return snapshot;
  } catch {
    throw new InsulinAdministrationSnapshotError();
  }
}
