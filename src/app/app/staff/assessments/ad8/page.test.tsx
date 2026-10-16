import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), snapshot: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ requireTenantContext: mocks.context }));
vi.mock("@/lib/questionnaire-assessments/snapshot", () => ({
  loadQuestionnaireSnapshot: mocks.snapshot,
  QuestionnaireSnapshotError: class QuestionnaireSnapshotError extends Error {},
}));
vi.mock("@/components/app/staff-access-denied", () => ({ StaffAccessDenied: () => null }));
vi.mock("@/components/questionnaire-assessments/questionnaire-assessment-editor", () => ({
  QuestionnaireAssessmentsWorkspace: () => null,
}));

import { StaffAccessDenied } from "@/components/app/staff-access-denied";
import { QuestionnaireAssessmentsWorkspace } from "@/components/questionnaire-assessments/questionnaire-assessment-editor";
import { QUESTIONNAIRE_FORMS } from "@/lib/questionnaire-assessments/forms";
import Ad8CandidatePage, { dynamic, metadata } from "./page";

const clientId = "a8100000-0000-4000-8000-000000000001";
const context = {
  organizationId: "a8200000-0000-4000-8000-000000000001",
  branchId: "a8300000-0000-4000-8000-000000000001",
  userId: "a8400000-0000-4000-8000-000000000001",
  displayName: "合成評估員",
  demo: false,
  scopes: ["clients.read", "questionnaire_cognition.read", "questionnaire_cognition.manage"],
};
const snapshot = {
  formKey: "ad8", generatedAt: "2026-10-08T00:00:00Z", matchingTotal: 1,
  clients: [{ clientId, displayName: "合成個案", serviceStatus: "active", latest: null }],
};
const props = (query: Record<string, string | string[] | undefined> = {}) => ({
  params: Promise.resolve({}), searchParams: Promise.resolve(query),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(context);
  mocks.snapshot.mockResolvedValue(snapshot);
});

describe("AD8 candidate direct page", () => {
  it("is dynamic and explicitly marked as an unapproved draft", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(metadata.description).toContain("未核准草稿");
    expect(QUESTIONNAIRE_FORMS.ad8.scoreVersionId).toBeUndefined();
  });

  it("rejects missing read scope before requesting a client roster", async () => {
    mocks.context.mockResolvedValue({ ...context, scopes: ["clients.read", "questionnaire_cognition.manage"] });
    const result = await Ad8CandidatePage(props());
    expect(result.type).toBe(StaffAccessDenied);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("loads only the selected client detail through the guarded snapshot", async () => {
    const result = await Ad8CandidatePage(props({ client: clientId.toUpperCase() }));
    expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith(context, "ad8", clientId);
    expect(result.type).toBe(QuestionnaireAssessmentsWorkspace);
    expect(result.props).toMatchObject({
      assessorName: context.displayName, canManage: true,
      form: QUESTIONNAIRE_FORMS.ad8, selectedClientId: clientId, snapshot,
      loadError: false,
    });
  });

  it.each([{ client: [clientId, clientId] }, { client: "invalid" }, { branch: context.branchId }])(
    "fails closed on malformed or scope-injecting query: %o", async (query) => {
      const result = await Ad8CandidatePage(props(query));
      expect(result.props.loadError).toBe(true);
      expect(mocks.snapshot).not.toHaveBeenCalled();
    },
  );

  it("uses only synthetic preview when explicitly in demo mode", async () => {
    mocks.context.mockResolvedValue({ ...context, demo: true, scopes: [] });
    const result = await Ad8CandidatePage(props());
    expect(result.props.canManage).toBe(false);
    expect(result.props.snapshot.demo).toBe(true);
    expect(result.props.snapshot.clients[0].displayName).toContain("合成");
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
});
