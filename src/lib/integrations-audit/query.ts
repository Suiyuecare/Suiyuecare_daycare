import {
  INTEGRATIONS_AUDIT_ACTIONS,
  INTEGRATIONS_AUDIT_ACTIVITY_STATES,
  INTEGRATIONS_AUDIT_INTEGRATION_KEYS,
  INTEGRATIONS_AUDIT_RESOURCE_CATEGORIES,
  type IntegrationsAuditFilters,
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_MS = 86_400_000;

function taipeiDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function validDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const instant = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(instant.getTime()) && taipeiDate(instant) === value;
}

function dayDistance(startDate: string, endDate: string) {
  return Math.round(
    (Date.parse(`${endDate}T12:00:00+08:00`) - Date.parse(`${startDate}T12:00:00+08:00`)) /
      DAY_MS,
  );
}

function nullableUuid(value: string | null) {
  const normalized = value?.trim().toLowerCase() || null;
  if (normalized !== null && !UUID.test(normalized)) {
    throw new Error("INVALID_INTEGRATIONS_AUDIT_FILTERS");
  }
  return normalized;
}

export function defaultIntegrationsAuditFilters(now = new Date()): IntegrationsAuditFilters {
  const endDate = taipeiDate(now);
  const startDate = taipeiDate(new Date(Date.parse(`${endDate}T12:00:00+08:00`) - 29 * DAY_MS));
  return {
    startDate,
    endDate,
    integrationKey: "all",
    activityState: "all",
    auditAction: "all",
    resourceCategory: "all",
    actorUserId: null,
    correlationId: null,
  };
}

export function parseIntegrationsAuditQuery(
  parameters: URLSearchParams,
  now = new Date(),
): IntegrationsAuditFilters {
  const allowed = new Set([
    "from",
    "to",
    "integration",
    "state",
    "action",
    "resource",
    "actor",
    "correlation",
  ]);
  if (
    [...parameters.keys()].some((key) => !allowed.has(key)) ||
    [...allowed].some((key) => parameters.getAll(key).length > 1)
  ) {
    throw new Error("INVALID_INTEGRATIONS_AUDIT_FILTERS");
  }

  const defaults = defaultIntegrationsAuditFilters(now);
  const startDate = parameters.get("from")?.trim() || defaults.startDate;
  const endDate = parameters.get("to")?.trim() || defaults.endDate;
  const integrationKey = parameters.get("integration")?.trim().toLowerCase() || "all";
  const activityState = parameters.get("state")?.trim().toLowerCase() || "all";
  const auditAction = parameters.get("action")?.trim().toLowerCase() || "all";
  const resourceCategory = parameters.get("resource")?.trim().toLowerCase() || "all";
  const actorUserId = nullableUuid(parameters.get("actor"));
  const correlationId = nullableUuid(parameters.get("correlation"));

  if (
    !validDate(startDate) ||
    !validDate(endDate) ||
    startDate > endDate ||
    dayDistance(startDate, endDate) > 89 ||
    !INTEGRATIONS_AUDIT_INTEGRATION_KEYS.includes(integrationKey as never) ||
    !INTEGRATIONS_AUDIT_ACTIVITY_STATES.includes(activityState as never) ||
    !INTEGRATIONS_AUDIT_ACTIONS.includes(auditAction as never) ||
    !INTEGRATIONS_AUDIT_RESOURCE_CATEGORIES.includes(resourceCategory as never)
  ) {
    throw new Error("INVALID_INTEGRATIONS_AUDIT_FILTERS");
  }

  return {
    startDate,
    endDate,
    integrationKey: integrationKey as IntegrationsAuditFilters["integrationKey"],
    activityState: activityState as IntegrationsAuditFilters["activityState"],
    auditAction: auditAction as IntegrationsAuditFilters["auditAction"],
    resourceCategory: resourceCategory as IntegrationsAuditFilters["resourceCategory"],
    actorUserId,
    correlationId,
  };
}

export function integrationsAuditFilterHref(filters: IntegrationsAuditFilters) {
  const parameters = new URLSearchParams({
    from: filters.startDate,
    to: filters.endDate,
    integration: filters.integrationKey,
    state: filters.activityState,
    action: filters.auditAction,
    resource: filters.resourceCategory,
  });
  if (filters.actorUserId) parameters.set("actor", filters.actorUserId);
  if (filters.correlationId) parameters.set("correlation", filters.correlationId);
  return `?${parameters.toString()}`;
}
