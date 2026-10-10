import "server-only";

import { z } from "zod";

import type { CareRosterSnapshot } from "@/lib/care-roster/types";
import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ActualTransportCaseSnapshot } from "./types";

const rowSchema = z.strictObject({
  clientId: z.uuid(),
  pickupStatus: z.enum(["not_scheduled", "scheduled_unreported", "boarded", "alighted", "exception"]),
  dropoffStatus: z.enum(["not_scheduled", "scheduled_unreported", "boarded", "alighted", "exception"]),
});
const payloadSchema = z.strictObject({
  serviceDate: z.iso.date(),
  generatedAt: z.iso.datetime({ offset: true }),
  rows: z.array(rowSchema).max(500),
});

export async function loadActualTransportCaseSnapshot(
  context: TenantContext,
  serviceDate: string,
  roster: CareRosterSnapshot | undefined,
): Promise<ActualTransportCaseSnapshot> {
  const unavailable: ActualTransportCaseSnapshot = {
    status: "unavailable", serviceDate, generatedAt: null, rows: [],
  };
  // No demo fixture may be mistaken for a real driver report.  A missing roster
  // or new RPC is an unavailable state, never a synthetic "did not ride".
  if (context.demo || !context.roles.includes("care_worker")
    || !context.scopes.includes("clients.read")
    || !context.scopes.includes("transport_case_status.read")
    || !roster || roster.status === "unavailable") return unavailable;

  const assigned = new Set(roster.assignments.filter((slot) => slot.state === "scheduled"
    && slot.staffUserId === context.userId && slot.isServiceEligible
    && slot.serviceEligibility === "eligible").map((slot) => slot.clientId));
  try {
    const supabase = await createServerSupabaseClient();
    if (!supabase) return unavailable;
    const { data, error } = await supabase.rpc("care_worker_actual_transport_status", {
      p_organization_id: context.organizationId,
      p_branch_id: context.branchId,
      p_service_date: serviceDate,
    }).maybeSingle<{ payload: unknown }>();
    if (error) return unavailable;
    const parsed = payloadSchema.safeParse(data?.payload);
    if (!parsed.success || parsed.data.serviceDate !== serviceDate) return unavailable;
    const ids = parsed.data.rows.map((row) => row.clientId);
    if (new Set(ids).size !== ids.length || ids.length !== assigned.size
      || ids.some((id) => !assigned.has(id))) return unavailable;
    return { status: "ready", ...parsed.data };
  } catch {
    return unavailable;
  }
}
