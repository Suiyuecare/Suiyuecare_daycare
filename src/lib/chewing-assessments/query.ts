import type { ChewingAssessmentFilters } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PREVIEW = new Set([
  "all", "candidate_complete", "incomplete", "not_assessed",
]);
const ANSWER_STATE = new Set([
  "all", "all_answered", "has_missing", "has_not_applicable",
]);

type Query = Record<string, string | string[] | undefined>;

export function parseChewingAssessmentFilters(query: Query): {
  filters: ChewingAssessmentFilters;
  invalidFilters: boolean;
} {
  const client = query.client;
  const preview = query.preview;
  const answers = query.answers;
  const knownKeys = new Set(["client", "preview", "answers"]);
  const hasUnknownKey = Object.keys(query).some((key) => !knownKeys.has(key));
  const clientValid = client === undefined || client === "" ||
    typeof client === "string" && UUID.test(client);
  const previewValid = preview === undefined ||
    typeof preview === "string" && PREVIEW.has(preview);
  const answersValid = answers === undefined ||
    typeof answers === "string" && ANSWER_STATE.has(answers);
  return {
    filters: {
      clientId: typeof client === "string" && client !== ""
        ? client.toLowerCase() : null,
      previewStatus: typeof preview === "string" && PREVIEW.has(preview)
        ? preview as ChewingAssessmentFilters["previewStatus"] : "all",
      answerState: typeof answers === "string" && ANSWER_STATE.has(answers)
        ? answers as ChewingAssessmentFilters["answerState"] : "all",
    },
    invalidFilters: hasUnknownKey || !clientValid || !previewValid ||
      !answersValid,
  };
}
