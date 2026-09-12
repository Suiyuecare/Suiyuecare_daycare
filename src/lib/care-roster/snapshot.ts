import "server-only";
import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { CareRosterSnapshot } from "./types";

const payloadSchema = z.object({
  manager: z.boolean(),
  assignments: z.array(z.object({
    id: z.uuid(), clientId: z.uuid(), staffUserId: z.uuid().nullable(), staffName: z.string().nullable(),
    serviceDate: z.iso.date(), shift: z.enum(["morning", "afternoon"]), version: z.number().int().positive(),
    state: z.enum(["scheduled", "cancelled"]), sourceNote: z.string(),
    tasks: z.array(z.object({ kind: z.enum(["temperature", "pulse", "blood_pressure", "oxygen_saturation", "care_diary"]),
      status: z.enum(["pending", "recorded", "restricted"]), evidenceAt: z.iso.datetime({ offset: true }).nullable() }).refine((task) => (task.status === "recorded") === (task.evidenceAt !== null))),
  })),
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
    if (!parsed.data.manager && (parsed.data.staffOptions.length || parsed.data.assignments.some((row) => row.staffUserId !== context.userId))) return unavailable;
    return { ...parsed.data, status: parsed.data.assignments.length ? "ready" : "empty", demo: false };
  } catch { return unavailable; }
}
