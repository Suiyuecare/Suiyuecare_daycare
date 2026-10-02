import { describe, expect, it } from "vitest";
import { staffPages } from "@/lib/catalog";
import type { TenantContext } from "@/lib/domain/types";
import { assessmentEntryHref, assessmentQuestionnaireFormKey, authorizedAssessmentEntryPages, isAssessmentClientSelectable, manageableAssessmentFormKeys, selectedAssessmentClientId } from "./selection";

const clientId = "c1600000-0000-4000-8000-000000000001";
const access = (scopes: TenantContext["scopes"]) => ({ demo: false, scopes });

describe("assessment work entry", () => {
  it("requires a client-read scope and shows only individually authorized tools", () => {
    expect(authorizedAssessmentEntryPages(access(["questionnaire_cognition.read"]), staffPages)).toEqual([]);
    expect(authorizedAssessmentEntryPages(access(["clients.read", "questionnaire_cognition.read"]), staffPages)
      .map((page) => page.number)).toEqual([11]);
    expect(authorizedAssessmentEntryPages(access(["clients.read", "questionnaire_swallowing.read"]), staffPages)
      .map((page) => page.number)).toEqual([17]);
  });

  it("keeps an unlisted or malformed client out of the selected state", () => {
    const clients = [{ id: clientId }];
    expect(selectedAssessmentClientId(clientId.toUpperCase(), clients)).toBe(clientId);
    expect(selectedAssessmentClientId("c1600000-0000-4000-8000-000000000002", clients)).toBeNull();
    expect(selectedAssessmentClientId([clientId, clientId], clients)).toBeNull();
    expect(selectedAssessmentClientId("not-a-client", clients)).toBeNull();
  });

  it("only deep-links current clients, with an encoded ID that the entry revalidates", () => {
    expect(assessmentEntryHref(clientId)).toBe(`/app/assessments?client=${clientId}`);
    expect(isAssessmentClientSelectable("active")).toBe(true);
    expect(isAssessmentClientSelectable("suspended")).toBe(true);
    for (const terminal of ["transferred", "closed", "deceased"] as const) {
      expect(isAssessmentClientSelectable(terminal)).toBe(false);
    }
  });

  it("only offers demo forms that share the entry's synthetic client IDs", () => {
    expect(authorizedAssessmentEntryPages({ demo: true, scopes: [] }, staffPages)
      .map((page) => page.number)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 36]);
  });

  it("distinguishes forms that can be edited from read-only forms", () => {
    const actor = access(["clients.read", "questionnaire_cognition.read", "questionnaire_cognition.manage",
      "questionnaire_emotion.read"]);
    const pages = authorizedAssessmentEntryPages(actor, staffPages);
    expect(manageableAssessmentFormKeys(actor, pages)).toEqual(["spmsq"]);
    expect(manageableAssessmentFormKeys({ ...actor, demo: true }, pages)).toEqual([]);
    expect(manageableAssessmentFormKeys(access(["questionnaire_cognition.manage"]), pages)).toEqual([]);
    expect(assessmentQuestionnaireFormKey(11)).toBe("spmsq");
    expect(assessmentQuestionnaireFormKey(36)).toBe("mna_sf");
    expect(assessmentQuestionnaireFormKey(35)).toBeNull();
  });
});
