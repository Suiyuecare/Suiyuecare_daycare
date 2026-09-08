import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoClientMasterSnapshot } from "./master-demo";
import {
  projectClientMasterSnapshot,
  type ClientMasterSourceRow,
} from "./master";

const MAX_CLIENT_MASTER_ROWS = 10_000;

type ClientMasterSnapshotRpcRow = Omit<ClientMasterSourceRow, "id"> & {
  client_id: string;
  visible_count: number;
};

export class ClientMasterSnapshotError extends Error {
  constructor() {
    super("CLIENT_MASTER_SNAPSHOT_UNAVAILABLE");
    this.name = "ClientMasterSnapshotError";
  }
}

export async function loadClientMasterSnapshot(
  context: TenantContext,
  interaction: "view" | "search" = "view",
) {
  if (context.demo) return buildDemoClientMasterSnapshot();
  if (!context.scopes.includes("clients.read")) {
    throw new ClientMasterSnapshotError();
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new ClientMasterSnapshotError();
  const result = await supabase.rpc("client_master_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_interaction: interaction,
  });
  if (result.error) throw new ClientMasterSnapshotError();
  if (result.data !== null && !Array.isArray(result.data)) {
    throw new ClientMasterSnapshotError();
  }
  const rpcRows = (result.data ?? []) as unknown as ClientMasterSnapshotRpcRow[];
  const expectedCount = rpcRows[0]?.visible_count ?? 0;
  if (
    !Number.isSafeInteger(expectedCount) ||
    expectedCount < 0 ||
    expectedCount > MAX_CLIENT_MASTER_ROWS ||
    rpcRows.length !== expectedCount ||
    rpcRows.some((row) => row.visible_count !== expectedCount)
  ) {
    throw new ClientMasterSnapshotError();
  }

  try {
    return projectClientMasterSnapshot({
      rows: rpcRows.map((row) => ({
        id: row.client_id,
        organization_id: row.organization_id,
        branch_id: row.branch_id,
        client_code: row.client_code,
        display_name: row.display_name,
        date_of_birth: row.date_of_birth,
        status: row.status,
        admitted_on: row.admitted_on,
        ended_on: row.ended_on,
        source_system: row.source_system,
        source_updated_at: row.source_updated_at,
        row_version: row.row_version,
        updated_at: row.updated_at,
      })),
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      generatedAt: new Date().toISOString(),
      demographicsReadable: context.scopes.includes(
        "clients.demographics.read",
      ),
      demo: false,
    });
  } catch {
    throw new ClientMasterSnapshotError();
  }
}
