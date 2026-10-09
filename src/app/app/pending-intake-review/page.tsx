import type { Metadata } from "next";
import { StaffAccessDenied } from "@/components/app/staff-access-denied";
import { PendingIntakeDirectorWorkspace } from "@/components/jubo-pending-director/workspace";
import { requireTenantContext } from "@/lib/auth/context";
import { readPendingDirectorDirectory, readPendingDirectorWorkspace } from "@/lib/jubo-pending-director/server";
import type { DirectorDirectory, DirectorWorkspace } from "@/lib/jubo-pending-director/contract";
import { taipeiDate } from "@/lib/clients/lifecycle-rules";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "主任待收案核對" };

type Query = Record<string, string | string[] | undefined>;
export default async function PendingIntakeReviewPage({ searchParams }: { searchParams: Promise<Query> }) {
  const actor = await requireTenantContext("staff");
  if (actor.demo || !actor.roles.includes("branch_director") ||
    !actor.scopes.includes("clients.jubo_pending_source.read") ||
    !actor.scopes.includes("clients.intake_draft.manage")) return <StaffAccessDenied />;

  const query = await searchParams;
  const requestedClient = typeof query.client === "string" ? query.client : "";
  let directory: DirectorDirectory | null = null;
  let workspace: DirectorWorkspace | null = null;
  let failed = false;
  try {
    directory = await readPendingDirectorDirectory(actor.organizationId, actor.branchId);
    if (requestedClient && directory.clients.some((client) => client.clientId === requestedClient)) {
      workspace = await readPendingDirectorWorkspace(actor.organizationId, actor.branchId, requestedClient);
    }
  } catch { failed = true; }
  return <PendingIntakeDirectorWorkspace
    branchName={actor.branchName}
    initialDirectory={directory}
    initialWorkspace={workspace}
    initialError={failed || Boolean(requestedClient && directory && !directory.clients.some((client) => client.clientId === requestedClient))}
    today={taipeiDate()}
  />;
}
