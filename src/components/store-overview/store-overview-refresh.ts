import type { StoreOverview } from "@/lib/store-overview/types";

export const STORE_REFRESH_INTERVAL_MS = 55_000;
export const STORE_REFRESH_RETRY_MS = 60_000;
export const STORE_REFRESH_MAX_FAILURES = 2;
export const STORE_REFRESH_CHECK_MS = 5_000;

/** ICU punctuation varies between Node and Chrome. Join the actual Taipei
 * date/time parts with fixed ASCII separators to keep SSR hydration exact. */
export function formatStoreTimestamp(value: string) {
  if (!Number.isFinite(Date.parse(value))) return "時間尚未確認";
  const parts = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    hourCycle: "h23" }).formatToParts(new Date(value));
  const field = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${field("month")}/${field("day")} ${field("hour")}:${field("minute")}:${field("second")}`;
}

/** Display identity only, not an authorization token. The server reauthorizes
 * every refresh. No amounts, client identities or credentials are retained. */
export function storeRefreshIdentity(overview: StoreOverview) {
  return JSON.stringify([overview.organizationName, overview.branchName,
    overview.periods.date, overview.periods.month, overview.demo, overview.invalid]);
}

export function financeRefreshTimestamp(overview: StoreOverview, now: number): number | null {
  if (overview.demo || overview.invalid || overview.finance.status !== "ready") return null;
  const text = overview.finance.data.generatedAt;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(text)) return null;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp) || now - timestamp > 60_000 || timestamp - now > 30_000) return null;
  return timestamp;
}

export function freshFinanceAfterRefresh(overview: StoreOverview, identity: string,
  previousTimestamp: number | null, now: number) {
  const timestamp = financeRefreshTimestamp(overview, now);
  return storeRefreshIdentity(overview) === identity && timestamp !== null &&
    (previousTimestamp === null || timestamp > previousTimestamp);
}
