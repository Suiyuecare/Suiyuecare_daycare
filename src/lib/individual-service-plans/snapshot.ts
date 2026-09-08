import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import {
  ClientMasterSnapshotError,
  loadClientMasterSnapshot,
} from "@/lib/clients/master-snapshot";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoIndividualServicePlanSnapshot } from "./demo";
import { planMonthDate } from "./date";
import { projectIndividualServicePlanSnapshot } from "./projection";

const MAX_PLAN_ROWS = 1_000;
const MAX_RESPONSIBLES = 1_000;

export class IndividualServicePlanSnapshotError extends Error {
  constructor() {
    super("INDIVIDUAL_SERVICE_PLAN_SNAPSHOT_UNAVAILABLE");
    this.name = "IndividualServicePlanSnapshotError";
  }
}

export async function loadIndividualServicePlanSnapshot(
  context: TenantContext,
  planMonth: string,
) {
  if (context.demo) return buildDemoIndividualServicePlanSnapshot(planMonth);
  if (!context.scopes.includes("clients.read") || !context.scopes.includes("care_plans.read")) {
    throw new IndividualServicePlanSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new IndividualServicePlanSnapshotError();
  const canWrite = context.scopes.includes("care_plans.write") && context.scopes.includes("care_plans.sign");
  try {
    const [master, plans, responsibles] = await Promise.all([
      loadClientMasterSnapshot(context, "view"),
      supabase.rpc("individual_service_plan_snapshot", {
        p_expected_organization_id: context.organizationId,
        p_expected_branch_id: context.branchId,
        p_plan_month: planMonthDate(planMonth),
      }),
      canWrite
        ? supabase.rpc("individual_service_plan_responsibles", {
            p_expected_organization_id: context.organizationId,
            p_expected_branch_id: context.branchId,
          })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (
      plans.error || responsibles.error ||
      (plans.data !== null && !Array.isArray(plans.data)) ||
      (responsibles.data !== null && !Array.isArray(responsibles.data)) ||
      (plans.data?.length ?? 0) > MAX_PLAN_ROWS ||
      (responsibles.data?.length ?? 0) > MAX_RESPONSIBLES
    ) throw new IndividualServicePlanSnapshotError();
    return projectIndividualServicePlanSnapshot({
      clients: master.clients,
      planRows: plans.data ?? [],
      responsibleRows: responsibles.data ?? [],
      planMonth,
      generatedAt: new Date().toISOString(),
      demo: false,
    });
  } catch (error) {
    if (error instanceof ClientMasterSnapshotError || error instanceof IndividualServicePlanSnapshotError) {
      throw new IndividualServicePlanSnapshotError();
    }
    throw new IndividualServicePlanSnapshotError();
  }
}
