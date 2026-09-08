import {
  CLIENT_SERVICE_STATUSES,
  type ClientServiceStatus,
  type PhysicalTherapyAssessmentFilters,
} from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DUE_STATUSES = ["all", "due", "upcoming", "not_assessed"] as const;
const ALLOWED_KEYS = new Set(["client", "therapist", "service", "due"]);

type Query = Record<string, string | string[] | undefined>;

export function parsePhysicalTherapyAssessmentFilters(query: Query): {
  filters: PhysicalTherapyAssessmentFilters;
  invalid: boolean;
} {
  const unknownKey = Object.keys(query).some((key) => !ALLOWED_KEYS.has(key));
  const arrayValue = Object.values(query).some(Array.isArray);
  const client = typeof query.client === "string" ? query.client : "";
  const therapist = typeof query.therapist === "string" ? query.therapist : "";
  const service = typeof query.service === "string" ? query.service : "";
  const due = typeof query.due === "string" ? query.due : "all";
  const serviceStatus = CLIENT_SERVICE_STATUSES.includes(
    service as ClientServiceStatus,
  ) ? service as ClientServiceStatus : null;
  const dueStatus = DUE_STATUSES.includes(
    due as (typeof DUE_STATUSES)[number],
  ) ? due as PhysicalTherapyAssessmentFilters["dueStatus"] : "all";
  const invalid = unknownKey || arrayValue ||
    (client !== "" && !UUID_PATTERN.test(client)) ||
    (therapist !== "" && !UUID_PATTERN.test(therapist)) ||
    (service !== "" && serviceStatus === null) ||
    !DUE_STATUSES.includes(due as (typeof DUE_STATUSES)[number]);
  return {
    filters: {
      clientId: UUID_PATTERN.test(client) ? client.toLowerCase() : null,
      therapistUserId: UUID_PATTERN.test(therapist)
        ? therapist.toLowerCase() : null,
      serviceStatus,
      dueStatus,
    },
    invalid,
  };
}
