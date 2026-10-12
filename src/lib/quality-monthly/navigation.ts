import type { QualityMonthlySnapshot } from "./contract";

const sourceRoutes = {
  attendance: "/app/staff/service-management/attendance",
  fall: "/app/staff/quality/falls",
  infection: "/app/staff/quality/infections",
  abnormal: "/app/staff/quality/incidents",
  weight: "/app/staff/quality/weight-management",
} as const;

/** The receiving page uses these exact filter names; never silently loses the date. */
export function qualitySourceHref(row: QualityMonthlySnapshot["metrics"][number]["numeratorItems"][number]) {
  const query = new URLSearchParams({ ...(row.clientId ? { client: row.clientId } : {}),
    ...(row.source === "attendance" ? { date: row.date } : row.source === "weight" ? { month: row.date.slice(0, 7) } : { from: row.date, to: row.date }),
  });
  return `${sourceRoutes[row.source]}?${query}`;
}
