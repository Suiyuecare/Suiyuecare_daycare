import { notFound } from "next/navigation";
import { requireTenantContext } from "@/lib/auth/context";
import { loadIntakeDirectory, readIntakeSnapshot } from "@/lib/client-intake/server";
import { IntakeWorkspace } from "@/components/client-intake/intake-workspace";
import { emptyIntakeProfile, type IntakeSnapshot } from "@/lib/client-intake/model";
import { env, hasSupabaseAdminConfiguration } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "個案匯入與收案" };
export default async function ClientIntakePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireTenantContext("staff");
  if (!context.demo && !["clients.read", "clients.demographics.read"].every((scope) => context.scopes.includes(scope))) notFound();
  const query = await searchParams;
  const selected = typeof query.client === "string" ? query.client : "";
  let clients: { id: string; displayName: string; clientCode: string }[] = [];
  let initialSnapshot: IntakeSnapshot | null = null;
  let loadError = false;
  try {
    const [directory, profile] = await Promise.all([loadIntakeDirectory(context), selected && !context.demo ? readIntakeSnapshot(context, selected) : Promise.resolve(null)]);
    clients = directory; initialSnapshot = profile;
    if (context.demo && selected) {
      const client = clients.find((candidate) => candidate.id === selected);
      if (!client) throw new Error("Unknown synthetic client");
      initialSnapshot = { clientId: client.id, profileVersion: 0, clientRowVersion: 1, pending: true, fieldAuthority: {}, sourceBatchId: null, profile: { ...emptyIntakeProfile, displayName: client.displayName, clientCode: client.clientCode } };
    }
  } catch { loadError = true; }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const initialStep = query.step === "weekly" ? 2 : query.step === "abcd" ? 3 : query.step === "documents" ? 4 : 1;
  // Only a readiness boolean crosses the server/client boundary. Configuration
  // presence does not certify the external archive; the API still verifies it.
  const archiveConfigured = env.AWS_REGION === "ap-northeast-1" && Boolean(env.HTML_ARCHIVE_BUCKET && env.AWS_KMS_KEY_ID) && hasSupabaseAdminConfiguration();
  // router.refresh preserves client state. Remount the whole private workspace
  // when its principal, data scope or requested client changes, so state created
  // in the previous branch cannot survive under a new authorization context.
  const workspaceKey = JSON.stringify({ organizationId: context.organizationId, branchId: context.branchId, userId: context.userId,
    roles: [...context.roles].sort(), scopes: [...context.scopes].sort(), selectedClient: selected });
  return <IntakeWorkspace key={workspaceKey} context={context} clients={clients} initialSnapshot={initialSnapshot} initialStep={initialStep} loadError={loadError} today={today} archiveConfigured={archiveConfigured} />;
}
