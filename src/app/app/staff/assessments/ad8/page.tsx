import type { Metadata } from "next";

import { StaffAccessDenied } from "@/components/app/staff-access-denied";
import { QuestionnaireAssessmentsWorkspace } from "@/components/questionnaire-assessments/questionnaire-assessment-editor";
import { requireTenantContext } from "@/lib/auth/context";
import { AD8_CANDIDATE_TITLE, canViewAd8Candidate } from "@/lib/questionnaire-assessments/ad8-candidate";
import { QUESTIONNAIRE_FORMS } from "@/lib/questionnaire-assessments/forms";
import { loadQuestionnaireSnapshot, QuestionnaireSnapshotError } from "@/lib/questionnaire-assessments/snapshot";
import type { QuestionnaireSnapshot } from "@/lib/questionnaire-assessments/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: AD8_CANDIDATE_TITLE,
  description: "AD8 八題認知變化候選題本；只保存有權限個案的未核准草稿。",
};

const clientIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export default async function Ad8CandidatePage({ searchParams }: PageProps<"/app/staff/assessments/ad8">) {
  const context = await requireTenantContext("staff");
  if (!canViewAd8Candidate(context)) return <StaffAccessDenied />;

  const query = await searchParams;
  const rawClientId = typeof query.client === "string" ? query.client : "";
  const selectedClientId = clientIdPattern.test(rawClientId) ? rawClientId.toLowerCase() : null;
  const invalidQuery = Object.keys(query).some((key) => key !== "client") ||
    (Object.hasOwn(query, "client") && (!rawClientId || !selectedClientId));
  const canManage = !context.demo && context.scopes.includes("questionnaire_cognition.manage");

  let snapshot: QuestionnaireSnapshot | null = null;
  let loadError = invalidQuery;
  if (context.demo) {
    snapshot = {
      formKey: "ad8",
      generatedAt: new Date().toISOString(),
      matchingTotal: 1,
      demo: true,
      clients: [{
        clientId: "00000000-0000-4000-8000-000000000016",
        displayName: "合成測試個案（非真實資料）",
        serviceStatus: "active",
        latest: null,
      }],
    };
  } else if (!invalidQuery) {
    try {
      snapshot = await loadQuestionnaireSnapshot(context, "ad8", selectedClientId);
    } catch (error) {
      if (!(error instanceof QuestionnaireSnapshotError)) throw error;
      loadError = true;
    }
  }

  return <QuestionnaireAssessmentsWorkspace
    assessorName={context.displayName}
    canManage={canManage}
    form={QUESTIONNAIRE_FORMS.ad8}
    loadError={loadError}
    pageTitle={AD8_CANDIDATE_TITLE}
    selectedClientId={selectedClientId}
    snapshot={snapshot}
  />;
}
