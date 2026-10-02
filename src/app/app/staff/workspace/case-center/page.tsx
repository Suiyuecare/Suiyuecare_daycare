import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { StaffAccessDenied } from "@/components/app/staff-access-denied";
import { CaseCenterWorkspace } from "@/components/core-care/case-center-workspace";
import { requireTenantContext } from "@/lib/auth/context";
import { canAccessCatalogPage, getPageBySlug, staffPages } from "@/lib/catalog";
import { caseCenterHref, parseCaseCenterFilters } from "@/lib/case-center/query";
import { CaseCenterRegistryError, loadCaseCenterSnapshot } from "@/lib/case-center/registry";

const slug = "staff/workspace/case-center";

// Never prerender a case list or reuse one staff member's authorization context.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const page = getPageBySlug(slug);
  return page ? { title: page.title, description: page.description } : {};
}

export default async function CaseCenterPage({
  searchParams,
}: PageProps<"/app/staff/workspace/case-center">) {
  const page = getPageBySlug(slug);
  if (!page || page.surface !== "staff") notFound();

  const context = await requireTenantContext("staff");
  if (!canAccessCatalogPage(context, page)) return <StaffAccessDenied />;

  const filters = parseCaseCenterFilters(await searchParams);
  let snapshot = null;
  let loadError = false;
  try {
    snapshot = await loadCaseCenterSnapshot(context, filters);
  } catch (error) {
    if (!(error instanceof CaseCenterRegistryError)) throw error;
    loadError = true;
  }
  if (snapshot && snapshot.page !== filters.page) {
    redirect(caseCenterHref({ ...filters, page: snapshot.page }));
  }

  return (
    <CaseCenterWorkspace
      canOpenIntake={context.demo || ["clients.read", "clients.demographics.read"].every((scope) => context.scopes.includes(scope))}
      allowedDailyPages={staffPages.filter((entry) => [46, 3, 6].includes(entry.number) && canAccessCatalogPage(context, entry)).map((entry) => entry.number)}
      allowedContinuationPages={staffPages.filter((entry) => [7, 8, 28].includes(entry.number) && canAccessCatalogPage(context, entry)).map((entry) => entry.number)}
      canViewSummary={staffPages.some((entry) => entry.number === 54 && canAccessCatalogPage(context, entry))}
      filters={filters}
      loadError={loadError}
      page={page}
      snapshot={snapshot}
    />
  );
}
