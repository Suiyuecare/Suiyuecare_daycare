import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { taipeiDayBoundsUtc } from "@/lib/core-care/date";
import { loadOrganizationProfileSnapshot } from "@/lib/organization-profile/snapshot";
import { loadStaffManagementSnapshot } from "@/lib/staff-management/snapshot";
import { loadClientMasterSnapshot } from "@/lib/clients/master-snapshot";
import { loadCareRosterSnapshot } from "@/lib/care-roster/snapshot";
import { projectOpeningReadiness, type ReadinessSource } from "./projection";
import { canViewOpeningReadiness, type OpeningReadinessSnapshot } from "./types";
import { buildDemoOpeningReadinessSources } from "./demo";

async function read<T>(load: () => Promise<T>): Promise<ReadinessSource<T>> {
  try { return { status: "available", data: await load() }; }
  catch { return { status: "unavailable" }; }
}

/** Uses the caller's existing audited/RLS-protected loaders, never an admin client or unscoped query. */
export async function loadOpeningReadinessSnapshot(context: TenantContext, serviceDate: string): Promise<OpeningReadinessSnapshot> {
  if (!canViewOpeningReadiness(context)) return { status: "forbidden" };
  taipeiDayBoundsUtc(serviceDate);
  if (context.demo) return projectOpeningReadiness({ context, serviceDate,
    sources: buildDemoOpeningReadinessSources(context, serviceDate) });
  const [institution, staff, clients, roster] = await Promise.all([
    read(() => loadOrganizationProfileSnapshot(context, { status: "all", effectiveOn: serviceDate, query: "" })),
    read(() => loadStaffManagementSnapshot(context, { status: "all", roleId: null, qualification: "all", query: "" })),
    read(() => loadClientMasterSnapshot(context)),
    read(() => loadCareRosterSnapshot(context, serviceDate)),
  ]);
  return projectOpeningReadiness({ context, serviceDate, sources: { institution, staff, clients, roster } });
}
