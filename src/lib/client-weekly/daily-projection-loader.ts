import "server-only";

import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { loadClientMasterSnapshot } from "@/lib/clients/master-snapshot";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { DailyExpectedState } from "./daily-projection";
import { projectDailyTransportReconciliation } from "./dispatch-reconciliation";

export async function loadDailyExpectedClients(context: TenantContext, serviceDate: string): Promise<DailyExpectedState> {
  if (!context.branchId || !context.scopes.includes("clients.read")) return { status: "forbidden", serviceDate };
  if (context.demo) return { status: "demo", serviceDate };
  if (!z.iso.date().safeParse(serviceDate).success || serviceDate < "2000-01-01" || serviceDate > "2100-01-01") {
    return { status: "unavailable", serviceDate };
  }
  try {
    const db = await createServerSupabaseClient();
    if (!db) return { status: "unavailable", serviceDate };
    const [projection, names] = await Promise.all([
      db.rpc("daily_transport_reconciliation", {
        p_organization_id: context.organizationId, p_branch_id: context.branchId, p_date: serviceDate,
      }).maybeSingle<{ payload: unknown }>(),
      // A separate audited directory is the only name source. Lack of identity
      // access does not expand it: a failed lookup uses an opaque-ID suffix.
      loadClientMasterSnapshot(context).then((snapshot) => new Map(snapshot.clients.map((row) => [row.id, row.displayName]))).catch(() => new Map<string, string>()),
    ]);
    if (projection.error) return { status: projection.error.code === "42501" ? "forbidden" : "unavailable", serviceDate };
    return projectDailyTransportReconciliation(projection.data?.payload, {
      organizationId: context.organizationId, branchId: context.branchId, serviceDate,
    }, names);
  } catch {
    return { status: "unavailable", serviceDate };
  }
}
