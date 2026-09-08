import type { MnaAssessmentFilters } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RISK = new Set(["all", "normal", "at_risk", "malnourished", "not_assessed"]);
const FOLLOW_UP = new Set(["all", "pending", "completed", "not_assessed"]);

type Query = Record<string, string | string[] | undefined>;

export function parseMnaAssessmentFilters(query: Query): {
  filters: MnaAssessmentFilters;
  invalidFilters: boolean;
} {
  const client = query.client;
  const risk = query.risk;
  const followUp = query.follow_up;
  const knownKeys = new Set(["client", "risk", "follow_up"]);
  const hasUnknownKey = Object.keys(query).some((key) => !knownKeys.has(key));
  const clientValid = client === undefined || client === "" ||
    typeof client === "string" && UUID.test(client);
  const riskValid = risk === undefined ||
    typeof risk === "string" && RISK.has(risk);
  const followUpValid = followUp === undefined ||
    typeof followUp === "string" && FOLLOW_UP.has(followUp);

  return {
    filters: {
      clientId: typeof client === "string" && client !== ""
        ? client.toLowerCase() : null,
      risk: typeof risk === "string" && RISK.has(risk)
        ? risk as MnaAssessmentFilters["risk"] : "all",
      followUp: typeof followUp === "string" && FOLLOW_UP.has(followUp)
        ? followUp as MnaAssessmentFilters["followUp"] : "all",
    },
    invalidFilters: hasUnknownKey || !clientValid || !riskValid ||
      !followUpValid,
  };
}

