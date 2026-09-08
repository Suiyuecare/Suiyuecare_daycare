export function isPlanMonth(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(value)) return false;
  const [year, month] = value.split("-").map(Number);
  return year >= 1900 && year <= 2200 && month >= 1 && month <= 12;
}

export function taipeiPlanMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("TAIPEI_MONTH_UNAVAILABLE");
  return `${year}-${month}`;
}

export function planMonthDate(value: string) {
  if (!isPlanMonth(value)) throw new Error("INVALID_PLAN_MONTH");
  return `${value}-01`;
}

export function planMonthLastDate(value: string) {
  if (!isPlanMonth(value)) throw new Error("INVALID_PLAN_MONTH");
  const [year, month] = value.split("-").map(Number);
  const day = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  return `${value}-${String(day).padStart(2, "0")}`;
}
