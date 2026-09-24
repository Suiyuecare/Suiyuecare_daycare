import { notFound } from "next/navigation";
import { requireTenantContext } from "@/lib/auth/context";
import { canReadIntakeCompleteness, type IntakeCompletenessSnapshot } from "@/lib/intake-completeness/model";
import { loadIntakeCompleteness } from "@/lib/intake-completeness/server";
import { IntakeCompletenessWorkspace } from "@/components/intake-completeness/intake-completeness-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "收案與補件表" };
export default async function IntakeCompletenessPage() {
  const context = await requireTenantContext("staff");
  if (!canReadIntakeCompleteness(context)) notFound();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  let snapshot: IntakeCompletenessSnapshot | null = null;
  let error: string | null = null;
  try { snapshot = await loadIntakeCompleteness(context, today); }
  catch { error = "本次無法核對收案資料或查閱權限，請稍後重試。尚未確認的資料不會算作完成。"; }
  const key = JSON.stringify({ organization: context.organizationId, branch: context.branchId, user: context.userId, roles: [...context.roles].sort(), scopes: [...context.scopes].sort() });
  return <IntakeCompletenessWorkspace key={key} initialSnapshot={snapshot} scope={{ organizationId: context.organizationId, branchId: context.branchId }} branchName={context.branchName} demo={context.demo} initialError={error} />;
}
