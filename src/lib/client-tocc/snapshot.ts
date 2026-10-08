import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { recordClinicalSnapshotFailure } from "@/lib/clinical-snapshot/diagnostics";
import {
  ClientMasterSnapshotError,
  loadClientMasterSnapshot,
} from "@/lib/clients/master-snapshot";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoClientToccSnapshot } from "./demo";
import { projectClientToccSnapshot } from "./projection";
import { taipeiCalendarDate } from "./validation";

const MAX_TOCC_ROWS = 1_000;

export class ClientToccSnapshotError extends Error {
  constructor(readonly requestId?: string) {
    super("CLIENT_TOCC_SNAPSHOT_UNAVAILABLE");
    this.name = "ClientToccSnapshotError";
  }
}

export async function loadClientToccSnapshot(context: TenantContext) {
  if (context.demo) return buildDemoClientToccSnapshot();
  const fail = (stage: "authorization" | "configuration" | "rpc" | "projection" | "dependency" | "unexpected", result?: { status?: unknown; error?: { code?: unknown } | null }) =>
    new ClientToccSnapshotError(recordClinicalSnapshotFailure(context, "client_tocc", stage, result));
  if (
    !context.scopes.includes("clients.read") ||
    !context.scopes.includes("health.read")
  ) {
    throw fail("authorization");
  }
  try {
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw fail("configuration");
    const [clientSnapshot, toccResult] = await Promise.all([
      loadClientMasterSnapshot(context, "view"),
      supabase.rpc("client_tocc_snapshot", {
        p_expected_organization_id: context.organizationId,
        p_expected_branch_id: context.branchId,
        p_client_id: null,
      }),
    ]);
    if (toccResult.error) throw fail("rpc", toccResult);
    if ((toccResult.data !== null && !Array.isArray(toccResult.data)) ||
      (toccResult.data?.length ?? 0) > MAX_TOCC_ROWS) throw fail("projection");
    const generatedAt = new Date();
    try {
      return projectClientToccSnapshot({
        clients: clientSnapshot.clients,
        assessmentRows: toccResult.data ?? [],
        generatedAt: generatedAt.toISOString(),
        todayTaipei: taipeiCalendarDate(generatedAt),
        demo: false,
      });
    } catch { throw fail("projection"); }
  } catch (error) {
    if (error instanceof ClientToccSnapshotError) throw error;
    if (error instanceof ClientMasterSnapshotError) throw fail("dependency");
    throw fail("unexpected");
  }
}
