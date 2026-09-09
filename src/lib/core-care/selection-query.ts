import { parseServiceDate } from "./date";

const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isDailyWorkClient(row: { status: string; admitted_on: string | null; ended_on: string | null }, serviceDate: string) {
  return row.status === "active" && row.admitted_on !== null && row.admitted_on <= serviceDate && row.ended_on === null;
}

/** Invalid or repeated selection must never silently pick another client/day. */
export function parseDailyWorkSelection(query: Record<string, string | string[] | undefined>, now = new Date()) {
  const serviceDate = parseServiceDate(typeof query.date === "string" ? query.date : undefined, now);
  const invalidDate = query.date !== undefined && (typeof query.date !== "string" || serviceDate !== query.date);
  const invalidClient = query.client !== undefined && (typeof query.client !== "string" || !CLIENT_ID.test(query.client));
  return {
    serviceDate,
    selectedClientId: typeof query.client === "string" && !invalidClient ? query.client.toLowerCase() : undefined,
    invalid: invalidDate || invalidClient,
  };
}
