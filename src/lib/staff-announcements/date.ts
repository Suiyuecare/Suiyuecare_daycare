export function taipeiLocalToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) {
    throw new Error("INVALID_LOCAL_DATETIME");
  }
  const parsed = new Date(`${value}:00+08:00`);
  if (!Number.isFinite(parsed.getTime())) throw new Error("INVALID_LOCAL_DATETIME");
  const roundTrip = new Date(parsed.getTime() + 8 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 16);
  if (roundTrip !== value) throw new Error("INVALID_LOCAL_DATETIME");
  return parsed.toISOString();
}

export function isoToTaipeiLocal(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("INVALID_TIMESTAMP");
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function defaultTaipeiLocal(now = new Date()) {
  return isoToTaipeiLocal(now.toISOString());
}
