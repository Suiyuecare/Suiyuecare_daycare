const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function isBillingDate(value: string) {
  const match = DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function billingTaipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function billingMonthStart(date: string) {
  if (!isBillingDate(date)) throw new Error("INVALID_BILLING_DATE");
  return `${date.slice(0, 7)}-01`;
}

export function billingRangeDays(from: string, to: string) {
  if (!isBillingDate(from) || !isBillingDate(to)) return Number.NaN;
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`))
    / 86_400_000) + 1;
}
