import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StaffAccessDenied } from "@/components/app/staff-access-denied";
import { DailyServiceSummaryWorkspace } from "@/components/daily-service-summary/daily-service-summary-workspace";
import { hasRecentAal2, requireTenantContext } from "@/lib/auth/context";
import { canAccessCatalogPage, getPageBySlug } from "@/lib/catalog";
import { parseDailyServiceSummaryQuery } from "@/lib/daily-service-summary/query";
import {
  DailyServiceSummarySnapshotError,
  loadDailyServiceSummarySnapshot,
} from "@/lib/daily-service-summary/snapshot";

const slug = "staff/service-management/daily-summary";

// An authorized care snapshot must be rebuilt for each request, never prerendered.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const page = getPageBySlug(slug);
  return page ? { title: page.title, description: page.description } : {};
}

export default async function DailySummaryPage({ searchParams }: PageProps<"/app/staff/service-management/daily-summary">) {
  const page = getPageBySlug(slug);
  if (!page || page.surface !== "staff") notFound();
  const context = await requireTenantContext("staff");
  if (!canAccessCatalogPage(context, page)) return <StaffAccessDenied />;

  const { filters, invalid } = parseDailyServiceSummaryQuery(await searchParams);
  const canExport = context.demo || (
    context.scopes.includes("clients.read") &&
    context.scopes.includes("daily_service_summary.read") &&
    context.scopes.includes("daily_service_summary.export")
  );
  let snapshot = null;
  let recentAal2 = context.demo;
  let loadError = invalid;
  if (!invalid) {
    try {
      [snapshot, recentAal2] = await Promise.all([
        loadDailyServiceSummarySnapshot(context, filters),
        canExport ? hasRecentAal2() : Promise.resolve(false),
      ]);
    } catch (error) {
      if (!(error instanceof DailyServiceSummarySnapshotError)) throw error;
      loadError = true;
    }
  }
  return <DailyServiceSummaryWorkspace canExport={canExport}
    filters={filters} hasRecentAal2={recentAal2} loadError={loadError}
    page={page} snapshot={snapshot} />;
}
