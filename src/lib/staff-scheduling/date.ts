const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export function isStaffSchedulingDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || year < 1900 || year > 2200 || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

export function staffSchedulingTaipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function addStaffSchedulingDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function staffSchedulingRangeDays(start: string, end: string) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) -
    Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}
