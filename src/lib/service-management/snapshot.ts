import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { taipeiDayBoundsUtc } from "@/lib/core-care/date";
import { loadAllClientDirectoryRows } from "@/lib/clients/directory";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  buildDemoClaimReadSnapshot,
  buildDemoServiceUsageSnapshot,
} from "./demo";
import { parseClaimReadRows } from "./claim-read-contract";
import type {
  ClaimReadSnapshot,
  ServiceEventStatus,
  ServiceUsageSnapshot,
} from "./types";

type ServiceEventRow = {
  id: string;
  client_id: string;
  service_code: string;
  status: ServiceEventStatus;
  started_at: string;
  ended_at: string | null;
  staff_user_id: string | null;
  client_service_plan_id: string | null;
  signed_at: string | null;
};

export class ServiceManagementSnapshotError extends Error {
  constructor() {
    super("SERVICE_MANAGEMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "ServiceManagementSnapshotError";
  }
}

function durationMinutes(startedAt: string, endedAt: string | null) {
  if (!endedAt) return null;
  const duration =
    (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000;
  return Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null;
}

export async function loadServiceUsageSnapshot(
  context: TenantContext,
  serviceDate: string,
): Promise<ServiceUsageSnapshot> {
  if (context.demo) return buildDemoServiceUsageSnapshot(serviceDate);
  if (
    !context.scopes.includes("clients.read") ||
    !context.scopes.includes("services.read")
  ) {
    throw new ServiceManagementSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new ServiceManagementSnapshotError();
  const { start, end } = taipeiDayBoundsUtc(serviceDate);
  const [clientRows, services] = await Promise.all([
    loadAllClientDirectoryRows(supabase, context, "service_usage").catch(() => {
      throw new ServiceManagementSnapshotError();
    }),
    supabase
      .from("service_events")
      .select(
        "id, client_id, service_code, status, started_at, ended_at, staff_user_id, client_service_plan_id, signed_at",
      )
      .eq("organization_id", context.organizationId)
      .eq("branch_id", context.branchId)
      .gte("started_at", start)
      .lt("started_at", end)
      .order("started_at", { ascending: false })
      .returns<ServiceEventRow[]>(),
  ]);
  if (services.error) {
    throw new ServiceManagementSnapshotError();
  }
  const clientById = new Map(
    clientRows.map((client) => [client.id, client]),
  );
  return {
    serviceDate,
    generatedAt: new Date().toISOString(),
    demo: false,
    clients: clientRows.map((client) => ({
      id: client.id,
      code: client.client_code,
      name: client.display_name,
      status: client.status,
      admittedOn: client.admitted_on,
      endedOn: client.ended_on,
    })),
    items: (services.data ?? []).flatMap((service) => {
      const client = clientById.get(service.client_id);
      return client
        ? [{
            id: service.id,
            clientId: service.client_id,
            clientCode: client.client_code,
            clientName: client.display_name,
            serviceCode: service.service_code,
            status: service.status,
            startedAt: service.started_at,
            endedAt: service.ended_at,
            durationMinutes: durationMinutes(
              service.started_at,
              service.ended_at,
            ),
            hasStaff: Boolean(service.staff_user_id),
            hasEffectivePlanLink: Boolean(service.client_service_plan_id),
            signedAt: service.signed_at,
          }]
        : [];
    }),
  };
}

export async function loadClaimReadSnapshot(
  context: TenantContext,
): Promise<ClaimReadSnapshot> {
  if (context.demo) return buildDemoClaimReadSnapshot();
  if (!context.scopes.includes("claims.read")) {
    throw new ServiceManagementSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new ServiceManagementSnapshotError();
  const { data, error } = await supabase
    .rpc("claim_batch_summaries", {
      p_branch_id: context.branchId,
      p_limit: 200,
    });
  if (error) throw new ServiceManagementSnapshotError();
  try {
    return { generatedAt: new Date().toISOString(), demo: false, batches: parseClaimReadRows(data) };
  } catch { throw new ServiceManagementSnapshotError(); }
}
