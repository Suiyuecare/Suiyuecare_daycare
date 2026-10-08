import type { Metadata } from "next";
import Link from "next/link";

import { AssessmentEntryWorkspace } from "@/components/assessments/assessment-entry-workspace";
import { StaffAccessDenied } from "@/components/app/staff-access-denied";
import { requireTenantContext } from "@/lib/auth/context";
import { canUseRoutineCare } from "@/lib/auth/routine-care";
import { canAccessCatalogPage, staffPages } from "@/lib/catalog";
import { ClientMasterSnapshotError, loadClientMasterSnapshot } from "@/lib/clients/master-snapshot";
import {
  externalAssessmentInstruments,
  permittedExternalAssessmentInstruments,
  type ExternalAssessmentInstrument,
} from "@/lib/external-assessment-results/contract";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "外部評估結果登錄",
  description: "選擇授權個案，登錄已核准的紙本或外部工具結果。",
};

type Query = Record<string, string | string[] | undefined>;

function invalidQuery(query: Query) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  return Object.entries(query).some(([key, value]) => {
    if (Array.isArray(value) || !["client", "externalInstrument"].includes(key)) return true;
    if (key === "client") return typeof value !== "string" || !uuid.test(value);
    return typeof value !== "string" || !Object.hasOwn(externalAssessmentInstruments, value);
  });
}

export default async function ExternalAssessmentResultsPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const context = await requireTenantContext("staff");
  if (context.demo || !context.scopes.includes("clients.read") ||
    !await canUseRoutineCare(context, "care_records.read")) return <StaffAccessDenied />;

  const readableExternalInstruments = permittedExternalAssessmentInstruments(context.scopes, "read");
  if (!readableExternalInstruments.length) return <StaffAccessDenied />;

  const query = await searchParams;
  if (invalidQuery(query)) return <section className="empty-card core-care-state" role="alert">
    <h1>評估連結無效</h1>
    <p>請重新選擇個案與評估項目；尚未讀取或變更個案資料。</p>
    <Link className="button button--secondary" href="/app/staff/assessments/external-results">清除篩選</Link>
  </section>;

  const selectedClientId = typeof query.client === "string" ? query.client.toLowerCase() : null;
  const initialExternalInstrument = typeof query.externalInstrument === "string"
    ? query.externalInstrument as ExternalAssessmentInstrument : null;
  if (initialExternalInstrument && !readableExternalInstruments.includes(initialExternalInstrument)) {
    return <StaffAccessDenied />;
  }
  const pageNumbers = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 28, 32, 33, 34, 35, 36, 51]);
  const pages = staffPages.filter((page) => pageNumbers.has(page.number) && canAccessCatalogPage(context, page));
  let clients: Awaited<ReturnType<typeof loadClientMasterSnapshot>>["clients"] = [];
  let error = false;
  try {
    clients = (await loadClientMasterSnapshot(context)).clients.filter((client) =>
      !["transferred", "closed", "deceased"].includes(client.status));
  } catch (cause) {
    if (!(cause instanceof ClientMasterSnapshotError)) throw cause;
    error = true;
  }
  const writableExternalInstruments = context.scopes.includes("care_records.write") &&
    await canUseRoutineCare(context, "care_records.write")
    ? permittedExternalAssessmentInstruments(context.scopes, "manage") : [];
  return <AssessmentEntryWorkspace
    clients={clients}
    error={error}
    pages={pages}
    unavailablePages={[]}
    selectedClientId={selectedClientId}
    initialExternalInstrument={initialExternalInstrument}
    readableExternalInstruments={readableExternalInstruments}
    writableExternalInstruments={writableExternalInstruments}
  />;
}
