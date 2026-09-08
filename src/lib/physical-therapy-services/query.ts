import { z } from "zod";

import { PHYSICAL_THERAPY_SERVICE_RECORD_STATES } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
});
const keyword = z.string().trim().min(1).max(80).refine((value) =>
  !/[\u0000-\u001f\u007f]/u.test(value));
const allowedKeys = new Set([
  "from", "to", "client", "therapist", "state", "q",
]);

export function parsePhysicalTherapyServiceQuery(
  raw: Record<string, string | string[] | undefined>,
) {
  for (const [key, value] of Object.entries(raw)) {
    if (!allowedKeys.has(key) || Array.isArray(value)) {
      throw new Error("INVALID_PHYSICAL_THERAPY_SERVICE_QUERY");
    }
  }
  const parsed = z.object({
    from: date.optional(),
    to: date.optional(),
    client: uuid.optional(),
    therapist: uuid.optional(),
    state: z.enum(PHYSICAL_THERAPY_SERVICE_RECORD_STATES).optional(),
    q: keyword.optional(),
  }).strict().safeParse(raw);
  if (!parsed.success ||
      (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to)) {
    throw new Error("INVALID_PHYSICAL_THERAPY_SERVICE_QUERY");
  }
  return {
    dateFrom: parsed.data.from ?? null,
    dateTo: parsed.data.to ?? null,
    clientId: parsed.data.client ?? null,
    therapistUserId: parsed.data.therapist ?? null,
    recordState: parsed.data.state ?? null,
    keyword: parsed.data.q ?? null,
  };
}
