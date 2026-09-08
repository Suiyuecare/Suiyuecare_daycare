import "server-only";

import type { TenantContext } from "@/lib/domain/types";
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
  constructor() {
    super("CLIENT_TOCC_SNAPSHOT_UNAVAILABLE");
    this.name = "ClientToccSnapshotError";
  }
}

export async function loadClientToccSnapshot(context: TenantContext) {
  if (context.demo) return buildDemoClientToccSnapshot();
  if (
    !context.scopes.includes("clients.read") ||
    !context.scopes.includes("health.read")
  ) {
    throw new ClientToccSnapshotError();
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new ClientToccSnapshotError();
  try {
    const [clientSnapshot, toccResult] = await Promise.all([
      loadClientMasterSnapshot(context, "view"),
      supabase.rpc("client_tocc_snapshot", {
        p_expected_organization_id: context.organizationId,
        p_expected_branch_id: context.branchId,
        p_client_id: null,
      }),
    ]);
    if (
      toccResult.error ||
      (toccResult.data !== null && !Array.isArray(toccResult.data)) ||
      (toccResult.data?.length ?? 0) > MAX_TOCC_ROWS
    ) {
      throw new ClientToccSnapshotError();
    }
    const generatedAt = new Date();
    return projectClientToccSnapshot({
      clients: clientSnapshot.clients,
      assessmentRows: toccResult.data ?? [],
      generatedAt: generatedAt.toISOString(),
      todayTaipei: taipeiCalendarDate(generatedAt),
      demo: false,
    });
  } catch (error) {
    if (
      error instanceof ClientToccSnapshotError ||
      error instanceof ClientMasterSnapshotError
    ) {
      throw new ClientToccSnapshotError();
    }
    throw new ClientToccSnapshotError();
  }
}
