import {
  ABCD_ASSESSMENT_STATES,
  ABCD_ASSESSMENT_TYPES,
  ABCD_VALUE_STATES,
  type AbcdAssessmentFilters,
} from "./types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function emptyAbcdAssessmentFilters(): AbcdAssessmentFilters {
  return { clientId: null, assessmentYear: null, assessmentType: "all",
    reassessmentState: "all", status: "all", query: null };
}

export function parseAbcdAssessmentFilters(parameters: URLSearchParams): AbcdAssessmentFilters {
  const allowed = new Set(["client", "year", "type", "reassessment", "status", "q"]);
  if ([...parameters.keys()].some((key) => !allowed.has(key)) ||
    [...allowed].some((key) => parameters.getAll(key).length > 1)) throw new Error("INVALID_ABCD_FILTERS");
  const client = parameters.get("client");
  const year = parameters.get("year");
  const type = parameters.get("type") ?? "all";
  const reassessment = parameters.get("reassessment") ?? "all";
  const status = parameters.get("status") ?? "all";
  const query = parameters.get("q")?.trim() || null;
  const parsedYear = year === null || year === "" ? null : Number(year);
  if ((client !== null && client !== "" && !uuid.test(client)) ||
    (parsedYear !== null && (!Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > 2200)) ||
    (type !== "all" && !ABCD_ASSESSMENT_TYPES.includes(type as never)) ||
    (reassessment !== "all" && !ABCD_VALUE_STATES.includes(reassessment as never)) ||
    (status !== "all" && !ABCD_ASSESSMENT_STATES.includes(status as never)) ||
    (query !== null && (query.length > 120 || /[\u0000-\u001f\u007f]/u.test(query)))) {
    throw new Error("INVALID_ABCD_FILTERS");
  }
  return { clientId: client?.toLowerCase() || null, assessmentYear: parsedYear,
    assessmentType: type as AbcdAssessmentFilters["assessmentType"],
    reassessmentState: reassessment as AbcdAssessmentFilters["reassessmentState"],
    status: status as AbcdAssessmentFilters["status"], query };
}
