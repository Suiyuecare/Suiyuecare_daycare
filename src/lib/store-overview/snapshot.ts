import "server-only";

import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { env, isSyntheticReadMode } from "@/lib/env";
import { parseReportPeriods } from "@/lib/reports/entry";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canReadStoreOverview } from "./access";
import { fetchFinanceSummary, financeConnection } from "./finance-client";
import type { AttendanceSummary, FinanceSummary, StoreOverview, SummarySource } from "./types";

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const attendanceSchema = z.object({
  organization_id: z.uuid(), branch_id: z.uuid(), service_date: z.string(),
  present: count, leave: count, absent: count, generated_at: z.iso.datetime({ offset: true }),
}).strict();

async function attendanceSummary(context: TenantContext, date: string): Promise<SummarySource<AttendanceSummary>> {
  const signal = AbortSignal.timeout(5_000);
  try {
    const db = await createServerSupabaseClient();
    if (!db) return { status: "unavailable" };
    const { data, error } = await db.rpc("read_store_attendance_summary", {
      p_organization_id: context.organizationId, p_branch_id: context.branchId, p_service_date: date,
    }).abortSignal(signal);
    if (error) return { status: signal.aborted ? "timeout" : "unavailable" };
    const parsed = attendanceSchema.safeParse(data);
    if (!parsed.success) return { status: "unavailable" };
    const value = parsed.data;
    const age = Date.now() - Date.parse(value.generated_at);
    if (value.organization_id !== context.organizationId || value.branch_id !== context.branchId ||
        value.service_date !== date || age > 60_000 || age < -30_000) return { status: "unavailable" };
    return { status: "ready", data: { present: value.present, leave: value.leave,
      absent: value.absent, generatedAt: value.generated_at } };
  } catch { return { status: signal.aborted ? "timeout" : "unavailable" }; }
}

async function financeSummary(context: TenantContext, month: string): Promise<SummarySource<FinanceSummary>> {
  const summary = await fetchFinanceSummary({ connection: financeConnection(env),
    organizationId: context.organizationId, branchId: context.branchId, month });
  if (summary.status !== "ready") return summary;
  try {
    const db = await createServerSupabaseClient();
    if (!db) return { status: "unavailable" };
    // Recheck the live session/scope and record a minimal read audit before
    // releasing any Finance amount. No amount, token or ledger row is logged.
    const { data, error } = await db.rpc("record_store_finance_summary_read", {
      p_organization_id: context.organizationId, p_branch_id: context.branchId, p_month: month,
    }).abortSignal(AbortSignal.timeout(5_000));
    return !error && data === true ? summary : { status: "unavailable" };
  } catch { return { status: "unavailable" }; }
}

/** Auth precedes every data request, including the server-to-server Finance call. */
export async function loadStoreOverview(context: TenantContext,
  query: Record<string, string | string[] | undefined>): Promise<StoreOverview | null> {
  if (!await canReadStoreOverview(context)) return null;
  const { periods, invalid } = parseReportPeriods(query);
  const base = { organizationName: context.organizationName, branchName: context.branchName,
    periods, invalid, demo: isSyntheticReadMode() };
  if (invalid) return { ...base, attendance: { status: "unavailable" }, finance: { status: "unavailable" } };
  if (isSyntheticReadMode()) {
    const generatedAt = new Date().toISOString();
    return { ...base,
      attendance: { status: "ready", data: { present: 24, leave: 3, absent: 1, generatedAt } },
      finance: { status: "ready", data: { income: "685000.00", expenses: "472350.00", entryCount: 36, generatedAt } },
    };
  }
  const [attendance, finance] = await Promise.all([
    attendanceSummary(context, periods.date),
    financeSummary(context, periods.month),
  ]);
  return { ...base, attendance, finance };
}
