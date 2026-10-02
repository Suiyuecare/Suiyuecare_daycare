import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ tenant: vi.fn(), snapshot: vi.fn(), resume: vi.fn(),
  SnapshotError: class QuestionnaireSnapshotError extends Error {} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ requireTenantContext: mocks.tenant, hasRecentAal2: vi.fn() }));
vi.mock("@/lib/questionnaire-assessments/snapshot", () => ({
  loadQuestionnaireSnapshot: mocks.snapshot,
  loadQuestionnaireResumeDraft: mocks.resume,
  QuestionnaireSnapshotError: mocks.SnapshotError,
}));

import StaffCatalogPage from "./page";
import type { TenantContext } from "@/lib/domain/types";

const id = "a1111111-1111-4111-8111-111111111111";
const assessmentKey = "a1111111-1111-4111-8111-111111111112";
const versionId = "a1111111-1111-4111-8111-111111111113";
const actor: TenantContext = { organizationId: id, branchId: id, userId: id,
  organizationName: "合成機構", branchName: "合成分支", displayName: "合成人員",
  roles: ["nurse"], scopes: ["clients.read", "questionnaire_cognition.read", "questionnaire_cognition.manage"],
  assuranceLevel: "aal2", recentAal2At: null, demo: false };
const baseline = { assessmentKey: id, versionId: id, version: 1, formVersion: "spmsq-pfeiffer-10-education-adjusted-v1",
  assessedOn: "2026-09-15", answers: {}, context: {}, recordState: "draft", authorDisplayName: "合成人員",
  createdAt: "2026-09-15T00:00:00Z", contentHash: "a".repeat(64) };
const exact = { ...baseline, assessmentKey, versionId, version: 2,
  createdAt: "2026-10-02T01:00:00Z" };
const snapshot = { formKey: "spmsq", generatedAt: "2026-10-02T01:01:00Z", matchingTotal: 1,
  clients: [{ clientId: id, displayName: "合成個案", serviceStatus: "active", latest: baseline,
    assessments: [], assessmentTotal: 1, nextAssessmentCursor: null }] };
const page = (query: Record<string, string | string[] | undefined>) => StaffCatalogPage({
  params: Promise.resolve({ slug: ["staff", "assessments", "spmsq"] }),
  searchParams: Promise.resolve(query),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenant.mockResolvedValue(actor);
  mocks.snapshot.mockResolvedValue(snapshot);
  mocks.resume.mockResolvedValue(exact);
});

describe("questionnaire saved-draft deep link dispatch", () => {
  it("rechecks the exact client, form, chain and version before preselecting a draft", async () => {
    const result = await page({ client: id, assessment: assessmentKey, version: versionId });
    expect(mocks.snapshot).toHaveBeenCalledWith(actor, "spmsq", id);
    expect(mocks.resume).toHaveBeenCalledWith(actor, "spmsq", id, assessmentKey, versionId);
    expect(result.props.selectedClientId).toBe(id);
    expect(result.props.loadError).toBe(false);
    expect(result.props.snapshot.clients[0].latest).toEqual(exact);
  });

  it("never substitutes another draft when the link's version is stale", async () => {
    mocks.resume.mockResolvedValueOnce(null);
    const result = await page({ client: id, assessment: assessmentKey, version: versionId });
    expect(result.props.role).toBe("alert");
    expect(result.props.children[0].props.children).toBe("草稿已有更新");
  });

  it("fails closed if exact read or client admission is unavailable", async () => {
    mocks.resume.mockRejectedValueOnce(new mocks.SnapshotError());
    const denied = await page({ client: id, assessment: assessmentKey, version: versionId });
    expect(denied.props.loadError).toBe(true);
    mocks.snapshot.mockResolvedValueOnce({ ...snapshot, clients: [] });
    const missing = await page({ client: id, assessment: assessmentKey, version: versionId });
    expect(missing.props.loadError).toBe(true);
  });

  it.each([
    { client: id, assessment: assessmentKey },
    { client: id, version: versionId },
    { client: id, assessment: [assessmentKey, assessmentKey], version: versionId },
    { client: id, assessment: assessmentKey, version: versionId, unknown: "yes" },
  ])("rejects malformed or extra resume parameters without reading clinical answers: %j", async (query) => {
    const result = await page(query);
    expect(result.props.loadError).toBe(true);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
  });

  it("leaves ordinary questionnaire navigation unchanged", async () => {
    const result = await page({ client: id });
    expect(result.props.snapshot.clients[0].latest).toEqual(baseline);
    expect(mocks.resume).not.toHaveBeenCalled();
  });
});
