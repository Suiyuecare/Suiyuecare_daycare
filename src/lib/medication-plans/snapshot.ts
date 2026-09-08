import "server-only";

import { loadAllClientDirectoryRows } from "@/lib/clients/directory";
import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoMedicationPlanSnapshot } from "./demo";
import {
  projectMedicationPlanSnapshot,
  type MedicationPlanSourceRow,
} from "./projection";
import type { MedicationPlanClientOption } from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_VISIBLE_CLIENTS = 1_000;

export class MedicationPlanSnapshotError extends Error {
  constructor() {
    super("MEDICATION_PLAN_SNAPSHOT_UNAVAILABLE");
    this.name = "MedicationPlanSnapshotError";
  }
}

function unavailable(): never {
  throw new MedicationPlanSnapshotError();
}

export async function loadMedicationPlanSnapshot(
  context: TenantContext,
  requestedClientId?: string,
) {
  if (requestedClientId && !UUID_PATTERN.test(requestedClientId)) unavailable();
  if (context.demo) {
    try {
      return buildDemoMedicationPlanSnapshot(
        requestedClientId?.toLowerCase(),
      );
    } catch {
      unavailable();
    }
  }
  if (
    !context.scopes.includes("clients.read") ||
    !context.scopes.includes("medications.read")
  ) {
    unavailable();
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) unavailable();
  let directoryRows;
  try {
    directoryRows = await loadAllClientDirectoryRows(
      supabase,
      context,
      "medication_plan",
      MAX_VISIBLE_CLIENTS,
    );
  } catch {
    unavailable();
  }
  const clients: MedicationPlanClientOption[] = directoryRows.map((client) => ({
    id: client.id,
    code: client.client_code,
    displayName: client.display_name,
    status: client.status,
    admittedOn: client.admitted_on,
    endedOn: client.ended_on,
    canCreatePlan:
      client.status === "active" &&
      client.admitted_on !== null &&
      client.ended_on === null,
  }));
  const selectedClient = requestedClientId
    ? clients.find((client) => client.id === requestedClientId.toLowerCase())
    : clients.find((client) => client.canCreatePlan) ?? clients[0];
  if (requestedClientId && !selectedClient) unavailable();
  if (!selectedClient) {
    try {
      return projectMedicationPlanSnapshot({
        rows: [],
        clients: [],
        selectedClient: null,
        generatedAt: new Date().toISOString(),
        demo: false,
      });
    } catch {
      unavailable();
    }
  }

  const { data, error } = await supabase.rpc("medication_plan_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_client_id: selectedClient.id,
  });
  if (error || (data !== null && !Array.isArray(data))) unavailable();
  try {
    return projectMedicationPlanSnapshot({
      rows: (data ?? []) as unknown as MedicationPlanSourceRow[],
      clients,
      selectedClient,
      generatedAt: new Date().toISOString(),
      demo: false,
    });
  } catch {
    unavailable();
  }
}
