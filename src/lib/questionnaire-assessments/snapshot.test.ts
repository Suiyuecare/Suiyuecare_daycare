import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ rpc }) }));

import { QUESTIONNAIRE_FORMS } from "./forms";
import { loadQuestionnaireSnapshot, QuestionnaireSnapshotError } from "./snapshot";

const clientId = "c1800000-0000-4000-8000-000000000001";
const versionId = "c1800000-0000-4000-8000-000000000002";
const context = { organizationId: clientId, branchId: versionId } as TenantContext;
const forms = Object.values(QUESTIONNAIRE_FORMS);

function snapshot(form: (typeof forms)[number]) {
  return {
    formKey: form.key, generatedAt: "2026-10-11T08:00:00Z", matchingTotal: 1,
    clients: [{ clientId, displayName: "合成個案", serviceStatus: "active", latest: {
      assessmentKey: clientId, versionId, version: 3, formVersion: form.version,
      assessedOn: "2026-09-03", answers: Object.fromEntries(form.questions.map(({ id }) => [id, { state: "missing" }])),
      context: {}, recordState: "submitted", authorDisplayName: "合成評估人員", createdAt: "2026-10-11T08:00:00Z",
      contentHash: "a".repeat(64), isLatest: true, correctionOfVersionId: null, changeReason: null,
      followUpDueOn: null, signedAt: null, signerDisplayName: null, ruleAvailable: false,
      formSnapshot: JSON.parse(JSON.stringify(form)), resultSnapshot: null,
    } }],
    history: [], historyTotal: 1, historyPage: 1, canSign: false,
    selection: { versionId, month: "2026-09", newAssessment: false },
  };
}

describe("exact-version questionnaire workspace contract", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it.each(forms)("reproduces the complete $key frozen question snapshot", async (form) => {
    const data = snapshot(form);
    rpc.mockResolvedValue({ data, error: null });
    const loaded = await loadQuestionnaireSnapshot(context, form.key, clientId,
      { versionId, month: "2026-09", newAssessment: false, historyPage: 2 });
    expect(loaded.clients[0].latest?.formSnapshot?.questions).toEqual(form.questions);
    expect(rpc).toHaveBeenCalledWith("questionnaire_assessment_workspace_snapshot", {
      p_expected_organization_id: clientId, p_expected_branch_id: versionId,
      p_form_key: form.key, p_client_id: clientId, p_version_id: versionId,
      p_month: "2026-09-01", p_new_assessment: false, p_history_page: 2,
    });
  });

  it("never accepts a different form in a historical record", async () => {
    const data = snapshot(QUESTIONNAIRE_FORMS.spmsq);
    data.clients[0].latest.formSnapshot = QUESTIONNAIRE_FORMS.gds_15;
    rpc.mockResolvedValue({ data, error: null });
    await expect(loadQuestionnaireSnapshot(context, "spmsq", clientId)).rejects.toBeInstanceOf(QuestionnaireSnapshotError);
  });

  it("accepts only unsigned draft history for source-authorized pending intake", async () => {
    const data = snapshot(QUESTIONNAIRE_FORMS.spmsq);
    data.clients[0].serviceStatus = "pending";
    data.clients[0].latest.recordState = "draft";
    rpc.mockResolvedValue({ data, error: null });
    expect((await loadQuestionnaireSnapshot(context, "spmsq", clientId)).clients[0].serviceStatus).toBe("pending");
    data.canSign = true;
    await expect(loadQuestionnaireSnapshot(context, "spmsq", clientId)).rejects.toBeInstanceOf(QuestionnaireSnapshotError);
    data.canSign = false;
    data.clients[0].latest.recordState = "submitted";
    await expect(loadQuestionnaireSnapshot(context, "spmsq", clientId)).rejects.toBeInstanceOf(QuestionnaireSnapshotError);
  });

  it("fails closed when the frozen questions do not match the saved answers", async () => {
    const data = snapshot(QUESTIONNAIRE_FORMS.spmsq);
    delete data.clients[0].latest.answers.spmsq_01;
    rpc.mockResolvedValue({ data, error: null });
    await expect(loadQuestionnaireSnapshot(context, "spmsq", clientId)).rejects.toBeInstanceOf(QuestionnaireSnapshotError);
  });
});
