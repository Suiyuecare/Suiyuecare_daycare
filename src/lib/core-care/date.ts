const SERVICE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export function taipeiToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function parseServiceDate(value: string | undefined, now = new Date()) {
  if (!value) return taipeiToday(now);
  if (!SERVICE_DATE_PATTERN.test(value)) return taipeiToday(now);

  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month! - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return taipeiToday(now);
  }
  return value;
}

export function taipeiDayBoundsUtc(serviceDate: string) {
  const parsed = parseServiceDate(serviceDate, new Date("2000-01-01T00:00:00Z"));
  if (parsed !== serviceDate) {
    throw new Error("INVALID_SERVICE_DATE");
  }
  const start = new Date(`${serviceDate}T00:00:00.000+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}
