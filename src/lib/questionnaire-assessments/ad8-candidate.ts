import type { TenantContext } from "@/lib/domain/types";

export const AD8_CANDIDATE_PATH = "/app/staff/assessments/ad8";
export const AD8_CANDIDATE_TITLE = "AD8 認知變化（草稿）";

export function canViewAd8Candidate(context: TenantContext) {
  return context.demo || ["clients.read", "questionnaire_cognition.read"]
    .every((scope) => context.scopes.includes(scope));
}
