import { billingMonthStart, billingRangeDays, billingTaipeiDate, isBillingDate } from "./date";
import { BILLING_PAYMENT_STATUSES, type BillingFilters, type BillingPaymentStatus } from "./types";

type Query = Record<string, string | string[] | undefined>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseBillingManagementFilters(query: Query, now = new Date()) {
  const today = billingTaipeiDate(now); const fallbackStart = billingMonthStart(today);
  const keys = Object.keys(query); let invalid = keys.some((key) => !["from", "to", "client", "status"].includes(key));
  const scalar = (name: string) => {
    const value = query[name]; if (Array.isArray(value)) { invalid = true; return undefined; }
    return value;
  };
  const fromRaw = scalar("from"); const toRaw = scalar("to");
  const clientRaw = scalar("client"); const statusRaw = scalar("status") ?? "all";
  const periodStart = fromRaw && isBillingDate(fromRaw) ? fromRaw : fallbackStart;
  const periodEnd = toRaw && isBillingDate(toRaw) ? toRaw : today;
  if ((fromRaw && periodStart !== fromRaw) || (toRaw && periodEnd !== toRaw)
    || billingRangeDays(periodStart, periodEnd) < 1
    || billingRangeDays(periodStart, periodEnd) > 367) invalid = true;
  const clientId = clientRaw && UUID.test(clientRaw) ? clientRaw.toLowerCase() : null;
  if (clientRaw && !clientId) invalid = true;
  const paymentStatus = BILLING_PAYMENT_STATUSES.includes(statusRaw as BillingPaymentStatus)
    ? statusRaw as BillingPaymentStatus : "all";
  if (paymentStatus !== statusRaw) invalid = true;
  const filters: BillingFilters = { periodStart, periodEnd, clientId, paymentStatus };
  return { filters, invalid };
}
