import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { StaffAccessDenied } from "@/components/app/staff-access-denied";
import {
  DailyExpectedClients,
  DailyExpectedClientsLoading,
} from "@/components/client-weekly/daily-expected-clients";
import { DashboardWorkspace } from "@/components/workspace/dashboard-workspace";
import { requireTenantContext } from "@/lib/auth/context";
import { canViewOpeningReadiness } from "@/lib/opening-readiness/types";
import { canAccessCatalogPage, getPageBySlug } from "@/lib/catalog";
import { loadCareRosterSnapshot } from "@/lib/care-roster/snapshot";
import { loadDailyExpectedClients } from "@/lib/client-weekly/daily-projection-loader";
import { parseServiceDate } from "@/lib/core-care/date";
import { CoreCareSnapshotError, loadDailyCareSnapshot } from "@/lib/core-care/snapshot";

const slug = "staff/workspace/dashboard";

// Identity, branch, assignments and care data must be resolved per request.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const page = getPageBySlug(slug);
  return page ? { title: page.title, description: page.description } : {};
}

export default async function DashboardPage({
  searchParams,
}: PageProps<"/app/staff/workspace/dashboard">) {
  const page = getPageBySlug(slug);
  if (!page || page.surface !== "staff") notFound();

  const context = await requireTenantContext("staff");
  if (!canAccessCatalogPage(context, page)) return <StaffAccessDenied />;
  const resumeScopeKey = createHash("sha256")
    .update(JSON.stringify([context.organizationId, context.branchId, context.userId]))
    .digest("hex");

  const query = await searchParams;
  const serviceDate = parseServiceDate(
    typeof query.date === "string" ? query.date : undefined,
  );
  // Start the independent panel before waiting for the main daily snapshot.
  // The promise stays request-scoped and is rendered under its own Suspense boundary.
  const expectedClientsPromise = loadDailyExpectedClients(context, serviceDate);
  const rosterPromise = loadCareRosterSnapshot(context, serviceDate).catch(() => undefined);
  let snapshot = null;
  let loadError = false;
  try {
    snapshot = await loadDailyCareSnapshot(context, serviceDate);
  } catch (error) {
    if (!(error instanceof CoreCareSnapshotError)) throw error;
    loadError = true;
  }

  return (
    <>
      <DashboardWorkspace
        canOpenReadiness={canViewOpeningReadiness(context) && (context.demo || context.scopes.includes("organization_profile.read"))}
        canViewManagementDetails={context.demo || context.scopes.includes("audit.view")}
        loadError={loadError}
        serviceDate={serviceDate}
        snapshot={snapshot}
        roster={await rosterPromise}
        resumeScopeKey={resumeScopeKey}
      />
      <Suspense fallback={<DailyExpectedClientsLoading />}>
        <DailyExpectedClients context={context} serviceDate={serviceDate} statePromise={expectedClientsPromise} />
      </Suspense>
    </>
  );
}
