import { BEHAVIOR_EVENT_STATES, type BehaviorEventFilters } from "./types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const date = /^\d{4}-\d{2}-\d{2}$/u;

function validDate(value: string | null) {
  if (!value || !date.test(value)) return value === null ? null : undefined;
  const instant = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(instant.getTime()) && new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant) === value ? value : undefined;
}

export function parseBehaviorEventFilters(parameters: URLSearchParams): BehaviorEventFilters {
  const allowed = new Set(["from", "to", "client", "type", "state"]);
  if ([...parameters.keys()].some((key) => !allowed.has(key)) ||
    [...allowed].some((key) => parameters.getAll(key).length > 1)) throw new Error("INVALID_BEHAVIOR_EVENT_FILTERS");
  const dateFrom = validDate(parameters.get("from"));
  const dateTo = validDate(parameters.get("to"));
  const client = parameters.get("client");
  const rawType = parameters.get("type");
  const rawState = parameters.get("state") ?? "all";
  if (dateFrom === undefined || dateTo === undefined || (dateFrom && dateTo && dateFrom > dateTo) ||
    (client !== null && !uuid.test(client)) ||
    (rawType !== null && (rawType.trim().length < 1 || rawType.trim().length > 120 || /[\u0000-\u001f\u007f]/u.test(rawType))) ||
    (rawState !== "all" && !BEHAVIOR_EVENT_STATES.includes(rawState as never))) {
    throw new Error("INVALID_BEHAVIOR_EVENT_FILTERS");
  }
  return { dateFrom: dateFrom ?? null, dateTo: dateTo ?? null,
    clientId: client?.toLowerCase() ?? null, eventType: rawType?.trim() ?? null,
    state: rawState as BehaviorEventFilters["state"] };
}
