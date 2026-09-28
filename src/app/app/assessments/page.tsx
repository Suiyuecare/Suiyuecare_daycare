import type { Metadata } from "next";
import Link from "next/link";

import { AssessmentEntryWorkspace } from "@/components/assessments/assessment-entry-workspace";
import { requireTenantContext } from "@/lib/auth/context";
import { staffPages } from "@/lib/catalog";
import { ClientMasterSnapshotError, loadClientMasterSnapshot } from "@/lib/clients/master-snapshot";
import { buildDemoCaseDirectory } from "@/lib/clients/demo-case-directory";
import type { ClientMasterItem } from "@/lib/clients/master-types";
import { withServerReadDeadline } from "@/lib/api/server-read-deadline";
import { authorizedAssessmentEntryPages, isAssessmentClientSelectable, selectedAssessmentClientId } from "@/lib/assessment-entry/selection";

export const metadata: Metadata = { title: "評估工作入口" };
export const dynamic = "force-dynamic";

export default async function AssessmentEntryPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantContext("staff");
  const pages = authorizedAssessmentEntryPages(context, staffPages);
  if (!pages.length) return <section className="empty-card" role="alert">
    <h1>目前無法開啟評估</h1>
    <p>這個帳號沒有可查看的個案評估表單。請由機構管理員確認工作指派。</p>
    <Link className="button button--secondary" href="/app/staff/workspace/dashboard">回今日工作</Link>
  </section>;

  const query = await searchParams;
  let clients: readonly Pick<ClientMasterItem, "id" | "displayName" | "clientCode" | "status">[] = [];
  let loadError = false;
  if (context.demo) {
    clients = buildDemoCaseDirectory().filter((client) => isAssessmentClientSelectable(client.status));
  } else {
    try {
      clients = (await withServerReadDeadline((signal) =>
        loadClientMasterSnapshot(context, "view", { signal }))).clients.filter((client) =>
        isAssessmentClientSelectable(client.status));
    } catch (error) {
      if (!(error instanceof ClientMasterSnapshotError) &&
        !(error instanceof Error && error.message === "SERVER_WORKSPACE_READ_UNAVAILABLE")) throw error;
      loadError = true;
    }
  }

  const selectedClientId = selectedAssessmentClientId(query.client, clients);

  return <AssessmentEntryWorkspace
    demo={context.demo}
    clients={clients}
    error={loadError}
    pages={pages}
    selectedClientId={selectedClientId}
    selectionRejected={query.client !== undefined && query.client !== "" && selectedClientId === null}
  />;
}
