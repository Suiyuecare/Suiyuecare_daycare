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
export interface OperationalReportLink {
  id: "intake" | "qualification" | "attendance-month";
  title: string; description: string; periodNote: string; href: string;
}

/** Source pages reauthorize; this list never reads records or expands a page permission. */
export function buildOperationalReportLinks(context: Pick<TenantContext, "demo" | "scopes">,
  periods: ReportPeriods, ownerAllowed = false): OperationalReportLink[] {
  if (parseReportPeriods({ ...periods }).invalid ||
    !canAccessCatalogPage(context, staffPages.find((page) => page.number === 70)!)) return [];
  const permits = (...keys: string[]) => context.demo || keys.every((key) => context.scopes.includes(key));
  const links: OperationalReportLink[] = [];
  if (permits("clients.read", "clients.demographics.read")) links.push({
    id: "intake", title: "收案與補件表", href: "/app/intake-completeness",
    description: "找出聯絡、同意、文件及週表待補事項，直接帶回同一位個案處理。",
    periodNote: "核對目前最新資料與今日效期，不套用上方歷史日期。",
  });
  if (permits("staff_certificates.read")) links.push({
    id: "qualification", title: "員工證照到期與補件", href: "/app/staff-qualification-readiness",
    description: "查看已過期、30 日內到期、登錄與證明待確認；沿用證照查閱權限與身分確認要求。",
    periodNote: "依今日計算未來 30 日，不等於已核准服務資格。",
  });
  if (ownerAllowed) links.push({
    id: "attendance-month", title: "出缺勤月報", href: `/app/store-attendance-month?month=${periods.month}`,
    description: "單店每天已登記人數、月人次與不重複出席個案；依既有執行長權限開放。",
    periodNote: `${periods.month}；不把未登記算成缺席，不推算出勤率。`,
  });
  return links;
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
