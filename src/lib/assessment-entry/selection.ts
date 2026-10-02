import { canAccessCatalogPage } from "@/lib/catalog";
import type { PageCatalogEntry } from "@/lib/catalog";
import type { ClientMasterItem } from "@/lib/clients/master-types";
import type { TenantContext } from "@/lib/domain/types";
import type { QuestionnaireFormKey } from "@/lib/questionnaire-assessments/types";

const entryPageNumbers = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 28, 32, 33, 34, 35, 36, 51]);
const connectedDemoPageNumbers = new Set([11, 12, 13, 14, 15, 16, 17, 18, 36]);
const clientIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const questionnaireByPage: Readonly<Record<number, { formKey: QuestionnaireFormKey; manageScope: string }>> = {
  11: { formKey: "spmsq", manageScope: "questionnaire_cognition.manage" },
  12: { formKey: "gds_15", manageScope: "questionnaire_emotion.manage" },
  13: { formKey: "fall_risk_taipei_115", manageScope: "questionnaire_fall.manage" },
  14: { formKey: "nsi_determine", manageScope: "questionnaire_nutrition.manage" },
  15: { formKey: "barthel_adl", manageScope: "questionnaire_adl.manage" },
  16: { formKey: "lawton_iadl", manageScope: "questionnaire_adl.manage" },
  17: { formKey: "eat10_swallowing", manageScope: "questionnaire_swallowing.manage" },
  18: { formKey: "bsrs5", manageScope: "questionnaire_emotion.manage" },
  36: { formKey: "mna_sf", manageScope: "questionnaire_nutrition.manage" },
};

export function assessmentQuestionnaireFormKey(pageNumber: number): QuestionnaireFormKey | null {
  return questionnaireByPage[pageNumber]?.formKey ?? null;
}

/** The entry only lists current/non-terminal clients; each form rechecks its
 * own assignment and record authority before showing or saving anything. */
export function isAssessmentClientSelectable(status: ClientMasterItem["status"]) {
  return status === "active" || status === "suspended";
}

export function assessmentEntryHref(clientId: string) {
  return `/app/assessments?${new URLSearchParams({ client: clientId })}`;
}

export function authorizedAssessmentEntryPages(
  context: Pick<TenantContext, "demo" | "scopes">,
  pages: readonly PageCatalogEntry[],
) {
  if (!context.demo && !context.scopes.includes("clients.read")) return [];
  return pages.filter((page) => entryPageNumbers.has(page.number) &&
    (!context.demo || connectedDemoPageNumbers.has(page.number)) && canAccessCatalogPage(context, page));
}

/** Entry labels must not promise editing when the user only has read access. */
export function manageableAssessmentFormKeys(
  context: Pick<TenantContext, "demo" | "scopes">,
  authorizedPages: readonly PageCatalogEntry[],
): readonly QuestionnaireFormKey[] {
  if (context.demo || !context.scopes.includes("clients.read")) return [];
  return authorizedPages.flatMap((page) => {
    const questionnaire = questionnaireByPage[page.number];
    return questionnaire && context.scopes.includes(questionnaire.manageScope) ? [questionnaire.formKey] : [];
  });
}

export function selectedAssessmentClientId(
  requested: unknown,
  clients: readonly Pick<ClientMasterItem, "id">[],
) {
  if (typeof requested !== "string" || !clientIdPattern.test(requested)) return null;
  const id = requested.toLowerCase();
  return clients.some((client) => client.id === id) ? id : null;
}
