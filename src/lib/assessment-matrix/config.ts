import type { QuestionnaireFormKey } from "@/lib/questionnaire-assessments/types";

export const ASSESSMENT_MATRIX_PATH = "/app/assessment-matrix";
export const ASSESSMENT_MATRIX_TITLE = "評估進度總覽";
export const ASSESSMENT_MATRIX_PAGE_SIZE = 20;

export function assessmentMatrixReady() {
  return process.env.ASSESSMENT_MATRIX_READY === "true";
}

// Keep this list in the same order as the guarded database snapshot. These are
// Exact terminal version status; no inferred clinical completion or due dates.
export const ASSESSMENT_MATRIX_FORMS: readonly {
  key: QuestionnaireFormKey;
  label: string;
  permission: string;
  href: string;
}[] = [
  { key: "spmsq", label: "SPMSQ", permission: "questionnaire_cognition.read", href: "/app/staff/assessments/spmsq" },
  { key: "gds_15", label: "GDS-15", permission: "questionnaire_emotion.read", href: "/app/staff/assessments/gds" },
  { key: "fall_risk_taipei_115", label: "跌倒風險", permission: "questionnaire_fall.read", href: "/app/staff/assessments/fall-risk" },
  { key: "nsi_determine", label: "NSI", permission: "questionnaire_nutrition.read", href: "/app/staff/assessments/nsi" },
  { key: "barthel_adl", label: "Barthel ADL", permission: "questionnaire_adl.read", href: "/app/staff/assessments/barthel-adl" },
  { key: "lawton_iadl", label: "IADL", permission: "questionnaire_adl.read", href: "/app/staff/assessments/iadl" },
  { key: "eat10_swallowing", label: "吞嚥", permission: "questionnaire_swallowing.read", href: "/app/staff/assessments/swallowing" },
  { key: "bsrs5", label: "BSRS-5", permission: "questionnaire_emotion.read", href: "/app/staff/assessments/bsrs" },
  { key: "mna_sf", label: "MNA-SF", permission: "questionnaire_nutrition.read", href: "/app/staff/professional-care/mna" },
];

export function canViewAssessmentMatrix(context: { demo: boolean; scopes: readonly string[] }) {
  return context.demo || (context.scopes.includes("clients.read") &&
    ASSESSMENT_MATRIX_FORMS.some((form) => context.scopes.includes(form.permission)));
}

export function assessmentFormHref(formKey: QuestionnaireFormKey, clientId: string, month?: string, versionId?: string): string | null {
  const form = ASSESSMENT_MATRIX_FORMS.find((entry) => entry.key === formKey);
  const query = new URLSearchParams({ client: clientId });
  if (month) query.set("month", month);
  if (versionId) query.set("version", versionId);
  return form ? `${form.href}?${query}` : null;
}
