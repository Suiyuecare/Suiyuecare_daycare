import "server-only";
import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loadAllClientDirectoryRows } from "@/lib/clients/directory";
import type { CareRosterSnapshot } from "./types";

const payloadSchema = z.object({
  manager: z.boolean(),
  assignments: z.array(z.object({
    id: z.uuid(), clientId: z.uuid(), staffUserId: z.uuid().nullable(), staffName: z.string().nullable(),
    serviceDate: z.iso.date(), shift: z.enum(["morning", "afternoon"]), version: z.number().int().positive(),
    state: z.enum(["scheduled", "cancelled"]), sourceNote: z.string(),
    isServiceEligible: z.boolean(), serviceEligibility: z.enum(["eligible", "not_admitted", "inactive"]),
    tasks: z.array(z.object({ kind: z.enum(["temperature", "pulse", "blood_pressure", "oxygen_saturation", "care_diary"]),
      status: z.enum(["pending", "recorded", "restricted"]), evidenceAt: z.iso.datetime({ offset: true }).nullable() }).refine((task) => (task.status === "recorded") === (task.evidenceAt !== null))),
  }).refine((row) => row.isServiceEligible === (row.serviceEligibility === "eligible")
    && (row.isServiceEligible || row.tasks.every((task) => task.status === "restricted" && task.evidenceAt === null)))),
  staffOptions: z.array(z.object({ userId: z.uuid(), name: z.string() })),
});

export async function loadCareRosterSnapshot(context: TenantContext, serviceDate: string): Promise<CareRosterSnapshot> {
  const unavailable: CareRosterSnapshot = { status: "unavailable", manager: false, assignments: [], staffOptions: [], demo: context.demo };
  if (context.demo) return { ...unavailable, status: "ready", manager: true,
    staffOptions: [{ userId: context.userId, name: "合成當班照服員" }],
    assignments: ["a1111111-1111-4111-8111-111111111111", "a2222222-2222-4222-8222-222222222222", "a3333333-3333-4333-8333-333333333333"].flatMap((clientId, i) => (["morning", "afternoon"] as const).map((shift) => ({
      id: `f${i + 1}111111-1111-4111-8111-${shift === "morning" ? "111111111111" : "222222222222"}`,
      clientId, staffUserId: i === 2 ? null : context.userId, staffName: i === 2 ? null : "合成當班照服員",
      serviceDate, shift, version: 1, state: "scheduled" as const, sourceNote: "合成示範：主管依已確認照顧計畫安排",
      isServiceEligible: true, serviceEligibility: "eligible" as const,
      tasks: [{ kind: "temperature" as const, status: i === 0 && shift === "morning" ? "recorded" as const : "pending" as const,
        evidenceAt: i === 0 && shift === "morning" ? `${serviceDate}T09:10:00+08:00` : null },
      { kind: "care_diary" as const, status: "pending" as const, evidenceAt: null }],
    }))) };
  const supabase = await createServerSupabaseClient();
  if (!supabase || !context.scopes.includes("clients.read")) return unavailable;
  try {
    const { data, error } = await supabase.rpc("care_roster_snapshot", {
      p_organization_id: context.organizationId, p_branch_id: context.branchId, p_service_date: serviceDate,
    }).maybeSingle<{ payload: unknown }>();
    if (error) return unavailable;
    const parsed = payloadSchema.safeParse(data?.payload);
    if (!parsed.success || parsed.data.assignments.some((row) => row.serviceDate !== serviceDate)) return unavailable;
    const assignmentKeys = parsed.data.assignments.map((row) => `${row.clientId}:${row.shift}`);
    if (new Set(assignmentKeys).size !== assignmentKeys.length) return unavailable;
    if (!parsed.data.manager && (parsed.data.staffOptions.length || parsed.data.assignments.some((row) => row.staffUserId !== context.userId || !row.isServiceEligible))) return unavailable;
    let assignments: CareRosterSnapshot["assignments"] = parsed.data.assignments;
    if (parsed.data.manager && assignments.some((row) => !row.isServiceEligible)) {
      // Identity follows the same audited, tenant- and assignment-scoped path
      // as the lifecycle page. Missing identity never becomes a UUID-based
      // cancellation choice or a guessed name from another client.
      const identities = await loadAllClientDirectoryRows(supabase, context, "client_lifecycle").catch(() => []);
      const byId = new Map(identities.map((client) => [client.id, client]));
      assignments = assignments.map((row) => {
        const identity = byId.get(row.clientId);
        return row.isServiceEligible ? row : { ...row, clientIdentity: identity
          ? { displayName: identity.display_name, clientCode: identity.client_code } : null };
      });
    }
    return { ...parsed.data, assignments, status: assignments.length ? "ready" : "empty", demo: false };
  } catch { return unavailable; }
}
