import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  FEEDBACK_CASE_TYPES,
  FEEDBACK_FILTER_STATES,
  FEEDBACK_RISKS,
  FEEDBACK_SOURCES,
  type FeedbackComplaintFilters,
} from "./types";

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const instant = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(instant.getTime()) && new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant) === value;
});
const uuid = z.uuid().transform((value) => value.toLowerCase());

function one(parameters: URLSearchParams, key: string) {
  const values = parameters.getAll(key);
  if (values.length > 1) throw new IntegrationError(
    "INVALID_FEEDBACK_FILTER", "意見與申訴篩選條件不得重複。", 400, key,
  );
  return values[0] ?? null;
}

export function parseFeedbackComplaintFilters(
  parameters: URLSearchParams,
): FeedbackComplaintFilters {
  const allowed = new Set([
    "from", "to", "source", "type", "risk", "assignee", "status", "q",
  ]);
  if ([...parameters.keys()].some((key) => !allowed.has(key))) {
    throw new IntegrationError(
      "INVALID_FEEDBACK_FILTER", "意見與申訴篩選包含未知欄位。", 400,
    );
  }
  const receivedFrom = one(parameters, "from") || null;
  const receivedTo = one(parameters, "to") || null;
  const source = one(parameters, "source") || "all";
  const caseType = one(parameters, "type") || "all";
  const risk = one(parameters, "risk") || "all";
  const assignee = one(parameters, "assignee") || "all";
  const status = one(parameters, "status") || "all";
  const query = (one(parameters, "q") || "").trim();
  const invalid =
    (receivedFrom !== null && !calendarDate.safeParse(receivedFrom).success) ||
    (receivedTo !== null && !calendarDate.safeParse(receivedTo).success) ||
    (receivedFrom !== null && receivedTo !== null && receivedTo < receivedFrom) ||
    !(source === "all" || FEEDBACK_SOURCES.includes(source as never)) ||
    !(caseType === "all" || FEEDBACK_CASE_TYPES.includes(caseType as never)) ||
    !(risk === "all" || FEEDBACK_RISKS.includes(risk as never)) ||
    !(assignee === "all" || assignee === "unassigned" || uuid.safeParse(assignee).success) ||
    !FEEDBACK_FILTER_STATES.includes(status as never) ||
    query.length > 120 || /[\u0000-\u001f\u007f]/u.test(query);
  if (invalid) throw new IntegrationError(
    "INVALID_FEEDBACK_FILTER", "意見與申訴日期或篩選值無效。", 400,
  );
  return {
    receivedFrom,
    receivedTo,
    source: source as FeedbackComplaintFilters["source"],
    caseType: caseType as FeedbackComplaintFilters["caseType"],
    risk: risk as FeedbackComplaintFilters["risk"],
    assignee: assignee === "all" || assignee === "unassigned"
      ? assignee : uuid.parse(assignee),
    status: status as FeedbackComplaintFilters["status"],
    query,
  };
}
