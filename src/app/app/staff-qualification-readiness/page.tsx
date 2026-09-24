import Link from "next/link";
import { requireTenantContext } from "@/lib/auth/context";
import { QualificationWorkspace } from "@/components/staff-qualification-readiness/qualification-workspace";
import { parseQualificationFilters } from "@/lib/staff-qualification-readiness/filters";
import { canReadQualificationReport, loadQualificationReport } from "@/lib/staff-qualification-readiness/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "員工證照到期與補件" };
export default async function QualificationPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantContext("staff");
  if (!canReadQualificationReport(context)) return <section className="panel" role="alert"><h1>無法查看員工證照清單</h1><p>此頁沿用員工證照查閱權限與身分確認要求。請洽主管確認權限，不會因此顯示其他員工資料。</p><Link className="button button--secondary" href="/app/staff/operations/staff-certificates">回員工證照</Link></section>;
  let filters;
  try { filters = parseQualificationFilters(await searchParams); }
  catch { return <section className="panel" role="alert"><h1>請檢查篩選條件</h1><p>待辦分類或員工篩選無法辨識，尚未讀取資料。</p><Link className="button button--secondary" href="/app/staff-qualification-readiness">清除篩選</Link></section>; }
  const report = await loadQualificationReport(context, filters);
  return <QualificationWorkspace report={report} />;
}
