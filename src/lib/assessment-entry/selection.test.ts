import { describe, expect, it } from "vitest";
import { staffPages } from "@/lib/catalog";
import type { TenantContext } from "@/lib/domain/types";
import { authorizedAssessmentEntryPages, selectedAssessmentClientId } from "./selection";

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

  it("only offers demo forms that share the entry's synthetic client IDs", () => {
    expect(authorizedAssessmentEntryPages({ demo: true, scopes: [] }, staffPages)
      .map((page) => page.number)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 36]);
  });
});
