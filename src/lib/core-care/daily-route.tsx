import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StaffAccessDenied } from "@/components/app/staff-access-denied";
import { CareReminderCard } from "@/components/care-reminders/care-reminder-card";
import { CareDiaryLifecycle } from "@/components/core-care/care-diary-lifecycle";
import { CoreDailyWorkspace } from "@/components/core-care/core-daily-workspace";
import { requireTenantContext } from "@/lib/auth/context";
import { canAccessCatalogPage, getModule, getPageBySlug } from "@/lib/catalog";
import { filterDailyCareSnapshotByClient } from "./projection";
import { loadCoreDailyPageInputs } from "./daily-page-inputs";
import { parseDailyWorkSelection } from "./selection-query";
import { isCoreDailyPage } from "./types";

export type CoreDailySlug =
  | "staff/service-management/attendance"
  | "staff/daily-care/vital-signs"
  | "staff/daily-care/care-diary";

export function coreDailyMetadata(slug: CoreDailySlug): Metadata {
  const page = getPageBySlug(slug);
  return page ? { title: page.title, description: page.description } : {};
}

/** Keep the three daily routes on the same authorization and selection path. */
export async function renderCoreDailyRoute(
  slug: CoreDailySlug,
  query: Record<string, string | string[] | undefined>,
) {
  const page = getPageBySlug(slug);
  if (!page || page.surface !== "staff" || !isCoreDailyPage(page)) notFound();

  const context = await requireTenantContext("staff");
  if (!canAccessCatalogPage(context, page)) return <StaffAccessDenied />;

  const { serviceDate, selectedClientId, selectedShift, invalid } = parseDailyWorkSelection(query);
  if (invalid) return <section className="empty-card core-care-state" role="alert">
    <h1>請重新選擇個案、日期與班別</h1>
    <p>連結中的個案、日期或班別格式不正確，系統沒有替您選擇其他個案或班別。</p>
    <Link className="button button--secondary" href="/app/staff/workspace/dashboard">回到今日工作</Link>
  </section>;

  const { snapshot: loadedSnapshot, canWriteRoutine, canReadDiary, canWriteNextStep, loadError } =
    await loadCoreDailyPageInputs(context, serviceDate, page.number);
  const nextPage = page.number === 46 ? getPageBySlug("staff/daily-care/vital-signs")
    : page.number === 3 ? getPageBySlug("staff/daily-care/care-diary") : undefined;
  const snapshot = loadedSnapshot && selectedClientId
    ? filterDailyCareSnapshotByClient(loadedSnapshot, selectedClientId)
    : loadedSnapshot;
  const selectedDailyClient = selectedClientId
    ? snapshot?.clients.find((client) => client.clientId === selectedClientId)
    : undefined;

  return <CoreDailyWorkspace
    clientAttention={snapshot?.sourceAccess.clients && selectedClientId && selectedDailyClient
      ? <CareReminderCard clientId={selectedClientId} context={context} /> : undefined}
    diaryLifecycle={page.number === 6 && snapshot?.sourceAccess.careDiaries && selectedClientId && selectedDailyClient
      ? <CareDiaryLifecycle clientId={selectedClientId} clientName={selectedDailyClient.displayName}
          clientCode={selectedDailyClient.clientCode} serviceDate={serviceDate} selectedShift={selectedShift}
          readEnabled={canReadDiary} enabled={canWriteRoutine}
          canRevise={!context.demo && context.assuranceLevel === "aal2" && context.scopes.includes("care_records.write")}
          canSign={!context.demo && context.assuranceLevel === "aal2" && context.scopes.includes("care_records.sign")}
          demo={context.demo} /> : undefined}
    canViewManagementDetails={context.demo || context.scopes.includes("audit.view")}
    caregiverMode={context.roles.length === 1 && context.roles[0] === "care_worker"}
    canWrite={canWriteRoutine}
    canWriteNextStep={Boolean(nextPage && canAccessCatalogPage(context, nextPage) && canWriteNextStep)}
    loadError={loadError}
    moduleTitle={getModule(page.moduleId).title}
    page={page}
    serviceDate={serviceDate}
    selectedClientId={selectedClientId}
    selectedShift={selectedShift}
    validatedScope={{ organizationId: context.organizationId, branchId: context.branchId, userId: context.userId }}
    snapshot={snapshot}
  />;
}
