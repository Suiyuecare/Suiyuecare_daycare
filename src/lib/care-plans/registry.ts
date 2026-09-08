import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { loadAllClientDirectoryRows } from "@/lib/clients/directory";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoCarePlanSnapshot } from "./demo";
import type {
  AuthorizedCarePlanSummary,
  CarePlanSnapshot,
  CarePlanVersionStatus,
  ClientServicePlanSummary,
} from "./types";

type CommonPlanRow = {
  id: string;
  client_id: string;
  plan_key: string;
  version: number;
  previous_version_id: string | null;
  status: CarePlanVersionStatus;
  effective_from: string;
  effective_to: string;
  source_system: string;
  source_record_id: string | null;
  correction_reason: string | null;
  created_at: string;
  signed_at: string | null;
};

type AuthorizedPlanRow = CommonPlanRow & {
  authorized_on: string | null;
  authorization_reference: string | null;
  service_limits: unknown;
};

type ServicePlanRow = CommonPlanRow & {
  authorized_care_plan_id: string;
  goals: unknown;
  planned_services: unknown;
  responsible_user_id: string | null;
  review_due_on: string | null;
};

export class CarePlanSnapshotError extends Error {
  constructor() {
    super("CARE_PLAN_SNAPSHOT_UNAVAILABLE");
    this.name = "CarePlanSnapshotError";
  }
}

function objectFieldCount(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).length
    : 0;
}

function arrayItemCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

export async function loadCarePlanSnapshot(
  context: TenantContext,
): Promise<CarePlanSnapshot> {
  if (context.demo) return buildDemoCarePlanSnapshot();
  if (
    !context.scopes.includes("clients.read") ||
    !context.scopes.includes("care_plans.read")
  ) {
    throw new CarePlanSnapshotError();
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new CarePlanSnapshotError();
  const [clientRows, authorized, services] = await Promise.all([
    loadAllClientDirectoryRows(supabase, context, "care_plans").catch(() => {
      throw new CarePlanSnapshotError();
    }),
    supabase
      .from("authorized_care_plans")
      .select(
        "id, client_id, plan_key, version, previous_version_id, status, effective_from, effective_to, source_system, source_record_id, correction_reason, created_at, signed_at, authorized_on, authorization_reference, service_limits",
      )
      .eq("organization_id", context.organizationId)
      .eq("branch_id", context.branchId)
      .order("created_at", { ascending: false })
      .returns<AuthorizedPlanRow[]>(),
    supabase
      .from("client_service_plans")
      .select(
        "id, client_id, plan_key, version, previous_version_id, status, effective_from, effective_to, source_system, source_record_id, correction_reason, created_at, signed_at, authorized_care_plan_id, goals, planned_services, responsible_user_id, review_due_on",
      )
      .eq("organization_id", context.organizationId)
      .eq("branch_id", context.branchId)
      .order("created_at", { ascending: false })
      .returns<ServicePlanRow[]>(),
  ]);
  if (authorized.error || services.error) {
    throw new CarePlanSnapshotError();
  }

  const clientById = new Map(
    clientRows.map((client) => [client.id, client]),
  );
  const common = (row: CommonPlanRow) => {
    const client = clientById.get(row.client_id);
    if (!client) return null;
    return {
      id: row.id,
      clientId: row.client_id,
      clientCode: client.client_code,
      clientName: client.display_name,
      planKey: row.plan_key,
      version: row.version,
      previousVersionId: row.previous_version_id,
      status: row.status,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      sourceSystem: row.source_system,
      sourceRecordId: row.source_record_id,
      correctionReason: row.correction_reason,
      createdAt: row.created_at,
      signedAt: row.signed_at,
    };
  };

  const authorizedPlans = (authorized.data ?? []).flatMap<AuthorizedCarePlanSummary>(
    (row) => {
      const base = common(row);
      return base
        ? [{
            ...base,
            authorizedOn: row.authorized_on,
            hasAuthorizationReference: Boolean(row.authorization_reference),
            serviceLimitFieldCount: objectFieldCount(row.service_limits),
          }]
        : [];
    },
  );
  const servicePlans = (services.data ?? []).flatMap<ClientServicePlanSummary>(
    (row) => {
      const base = common(row);
      return base
        ? [{
            ...base,
            authorizedCarePlanId: row.authorized_care_plan_id,
            goalCount: arrayItemCount(row.goals),
            plannedServiceCount: arrayItemCount(row.planned_services),
            responsibleUserId: row.responsible_user_id,
            reviewDueOn: row.review_due_on,
          }]
        : [];
    },
  );

  return {
    generatedAt: new Date().toISOString(),
    authorizedPlans,
    servicePlans,
    demo: false,
  };
}
