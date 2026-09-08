import { canAccessCatalogPage, staffPages } from "@/lib/catalog";
import { parseDailyServiceSummaryQuery } from "@/lib/daily-service-summary/query";
import type { TenantContext } from "@/lib/domain/types";
import { parseProfessionalServiceSummaryQuery } from "@/lib/professional-service-summary/query";

export interface ReportPeriods { date: string; month: string }
export interface ReportEntry {
  pageNumber: number;
  title: string;
  period: string;
  description: string;
  source: string;
  definition: string;
  limitation: string;
  href: string | null;
}

/** Navigation only: no business records, report totals or synthetic timestamps. */
export function parseReportPeriods(query: Record<string, string | string[] | undefined>) {
  const daily = parseDailyServiceSummaryQuery({ date: query.date });
  const monthly = parseProfessionalServiceSummaryQuery({ month: query.month });
  return {
    periods: { date: daily.filters.serviceDate, month: monthly.filters.month },
    invalid: daily.invalid || monthly.invalid ||
      Object.keys(query).some((key) => !["date", "month"].includes(key)),
  };
}

export function buildReportEntries(
  context: Pick<TenantContext, "demo" | "scopes">,
  periods: ReportPeriods,
): ReportEntry[] {
  // Validate again so callers cannot create a navigation link with injected filters.
  if (parseReportPeriods({ ...periods }).invalid) return [];
  const reports = staffPages.find((page) => page.number === 70)!;
  if (!canAccessCatalogPage(context, reports)) return [];
  return [
    {
      pageNumber: 54, period: periods.date,
      description: "查看當日出勤、量測、活動、餐食、交通與異常的紀錄覆蓋情形。",
      source: "每日服務彙整的 8 類來源；由來源頁逐項檢查權限及指派個案。",
      definition: "各來源的已記錄個案數、工作量與缺項分開顯示；無權限、未設定與無紀錄不互相替代。",
      limitation: "紀錄覆蓋不代表核定服務已完成，也不是申報件數或金額。",
      query: new URLSearchParams({ date: periods.date }),
    },
    {
      pageNumber: 42, period: periods.month,
      description: "查看當月專業評估、照會、會議、轉介及治療服務的工作狀態。",
      source: "專業服務彙整表連結第 33–41 頁的權威來源與紀錄版本。",
      definition: "應完成、已完成、待完成、逾期依來源內明示期限及既有工作單位計算。",
      limitation: "不推測未建立的評估；未設定的頻率、授權與正式規則不能當作 0 或已完成。",
      query: new URLSearchParams({ month: periods.month }),
    },
  ].map(({ query, ...report }) => {
    const source = staffPages.find((page) => page.number === report.pageNumber)!;
    return {
      ...report,
      title: source.title,
      href: canAccessCatalogPage(context, source)
        ? `/app/${source.slug}?${query.toString()}` : null,
    };
  });
}
