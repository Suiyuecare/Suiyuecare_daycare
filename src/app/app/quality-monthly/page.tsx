import { requireTenantContext } from "@/lib/auth/context";
import { taipeiToday } from "@/lib/core-care/date";
import { QualityMonthlyWorkspace } from "@/components/quality-monthly/quality-monthly-workspace";
import { loadQualityMonthlySnapshot } from "@/lib/quality-monthly/snapshot";
import { qualityMonthSchema } from "@/lib/quality-monthly/contract";

export const dynamic = "force-dynamic";
export const metadata = { title: "品質月報" };

export default async function QualityMonthlyPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantContext("staff");
  const query = await searchParams;
  const month = typeof query.month === "string" ? query.month : taipeiToday().slice(0, 7);
  const validQuery = Object.keys(query).every((key) => ["month", "snapshot"].includes(key)) &&
    qualityMonthSchema.safeParse(month).success && (query.snapshot === undefined || typeof query.snapshot === "string");
  let snapshot = null;
  if (validQuery) {
    try { snapshot = await loadQualityMonthlySnapshot(context, month, typeof query.snapshot === "string" ? query.snapshot : null); }
    catch { /* The error state preserves the current scope, never substitutes another branch. */ }
  }
  return <QualityMonthlyWorkspace snapshot={snapshot} month={month} actorUserId={context.userId} canExport={context.scopes.includes("quality_monthly.export")} />;
}
