import { BODY_RECORD_STATES, type BodyAssessmentFilters } from "./types";
import { bodyUuid } from "./parser";
export function parseBodyAssessmentFilters(params: URLSearchParams): BodyAssessmentFilters {
  if ([...params.keys()].some((k) => !["client", "state"].includes(k)) ||
    ["client", "state"].some((k) => params.getAll(k).length > 1)) throw new Error("INVALID_BODY_ASSESSMENT_FILTERS");
  const client = params.get("client") || null; const state = params.get("state") ?? "all";
  if ((client !== null && !bodyUuid.safeParse(client).success) ||
    (state !== "all" && !BODY_RECORD_STATES.includes(state as never))) throw new Error("INVALID_BODY_ASSESSMENT_FILTERS");
  return { clientId: client?.toLowerCase() ?? null, state: state as BodyAssessmentFilters["state"] };
}
