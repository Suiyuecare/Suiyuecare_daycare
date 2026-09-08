const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export function isOrganizationProfileDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year! < 1900 || year! > 2200) return false;
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day;
}

export function organizationProfileTaipeiDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}
