import { beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_MNA_DEFINITION, FULL_MNA_SOURCE_SHA256 } from "@/lib/assessments/full-mna";
import type { TenantContext } from "@/lib/domain/types";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ rpc }) }));
import { QUESTIONNAIRE_FORMS } from "./forms";
import { loadQuestionnaireSnapshot, QuestionnaireSnapshotError } from "./snapshot";
import { loadQuestionnaireGovernance } from "./governance-snapshot";
const clientId = "fb180000-0000-4000-8000-000000000001";
const versionId = "fb1e0000-0000-4000-8000-000000000001";
const context = { organizationId: "fb150000-0000-4000-8000-000000000001", branchId: "fb160000-0000-4000-8000-000000000001",
  demo: false, scopes: ["forms.manage"] } as TenantContext;
function signedSnapshot() {
  const answers = Object.fromEntries(FULL_MNA_DEFINITION.items.map((item) => [item.id, { state: "answered", value: [...item.choices].sort((a, b) => b.points - a.points)[0]!.value }]));
  answers.protein_intake = { state: "answered", value: "two_yes" };
  return { formKey: "full_mna", generatedAt: "2026-10-12T01:00:00Z", matchingTotal: 1,
    clients: [{ clientId, displayName: "合成完整評估個案", serviceStatus: "active", latest: {
      assessmentKey: clientId, versionId, version: 3, formVersion: QUESTIONNAIRE_FORMS.full_mna.version, assessedOn: "2026-10-11",
      answers, context: { height_cm: "160", weight_kg: "64", arm_circumference_cm: "22", calf_circumference_cm: "31", protein_dairy: "no", protein_legumes_eggs: "yes", protein_meat_fish_poultry: "yes" },
      recordState: "signed", authorDisplayName: "合成評估人員", createdAt: "2026-10-12T00:00:00Z", contentHash: "a".repeat(64),
      isLatest: true, correctionOfVersionId: null, changeReason: null, followUpDueOn: null, signedAt: "2026-10-12T00:01:00Z",
      signerDisplayName: "合成簽署人員", ruleAvailable: true, formSnapshot: JSON.parse(JSON.stringify(QUESTIONNAIRE_FORMS.full_mna)),
      resultSnapshot: { status: "complete", raw: 29.5, adjusted: 29.5, classification: FULL_MNA_DEFINITION.classify(29.5), unit: "points", incompleteCount: 0 },
    } }],
    history: [], historyTotal: 1, historyPage: 1, canSign: true,
    selection: { versionId, month: "2026-10", newAssessment: false },
  };
}
describe("full MNA signed and governance snapshot contracts", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it("reads an exact signed Full result without dropping or rounding its halfpoint", async () => {
    rpc.mockResolvedValue({ data: signedSnapshot(), error: null });
    const value = await loadQuestionnaireSnapshot(context, "full_mna", clientId, { versionId, month: "2026-10", newAssessment: false });
    expect(value.clients[0].latest).toMatchObject({ recordState: "signed", formSnapshot: { key: "full_mna", sourceHash: FULL_MNA_SOURCE_SHA256 },
      resultSnapshot: { raw: 29.5, adjusted: 29.5, classification: { key: "normal_full_24_30" } } });
    expect(value.clients[0].latest!.formSnapshot!.questions).toHaveLength(18);
  });
  it.each(["hash", "url"])("rejects a different source %s under the same Full version", async (field) => {
    const data = signedSnapshot();
    data.clients[0].latest.formSnapshot[field === "hash" ? "sourceHash" : "sourceUrl"] = field === "hash" ? "b".repeat(64) : "https://example.invalid/other-form.pdf";
    rpc.mockResolvedValue({ data, error: null });
    await expect(loadQuestionnaireSnapshot(context, "full_mna", clientId)).rejects.toBeInstanceOf(QuestionnaireSnapshotError);
  });
  it("parses all10 governed catalogues including precise Full rules without manufacturing publication", async () => {
    const catalogue = Object.values(QUESTIONNAIRE_FORMS).map((form) => ({ formKey: form.key, formVersion: form.version,
      catalogHash: "a".repeat(64), title: form.title, questionCount: form.questions.length,
      sources: form.key === "full_mna" ? FULL_MNA_DEFINITION.sources : [],
      rule: form.key === "full_mna" ? { scoreMax: 30, items: FULL_MNA_DEFINITION.items, bands: [FULL_MNA_DEFINITION.classify(0), FULL_MNA_DEFINITION.classify(17), FULL_MNA_DEFINITION.classify(24)] } : {},
    }));
    rpc.mockResolvedValue({ data: { generatedAt: "2026-10-12T01:00:00Z", catalogue, publications: [] }, error: null });
    const value = await loadQuestionnaireGovernance(context);
    expect(value?.catalogue).toHaveLength(10); expect(value?.publications).toEqual([]);
    expect(value?.catalogue.find((item) => item.formKey === "full_mna")).toMatchObject({ questionCount: 18,
      sources: [{ sha256: FULL_MNA_SOURCE_SHA256 }], rule: { scoreMax: 30 } });
  });
});
