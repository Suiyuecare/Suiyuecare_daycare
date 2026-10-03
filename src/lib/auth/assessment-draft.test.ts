import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";

const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));

import { canUseAssessmentDraft, hasRecentBodyAssessmentAal2 } from "./assessment-draft";

const actor: TenantContext = {
  organizationId: "11111111-1111-4111-8111-111111111111", organizationName: "合成機構",
  branchId: "22222222-2222-4222-8222-222222222222", branchName: "合成分支",
  userId: "33333333-3333-4333-8333-333333333333", displayName: "合成護理師",
  roles: ["nurse"], scopes: ["clients.read", "body_assessments.read", "body_assessments.manage",
    "abcd_assessments.read", "abcd_assessments.manage", "behavior_events.read", "behavior_events.manage"],
  assuranceLevel: "aal1", recentAal2At: null, demo: false,
};
const clientId = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

describe("approved Google assessment drafts", () => {
  it.each(["body", "abcd", "behavior"] as const)("checks exact live branch and case for %s", async (kind) => {
    expect(await canUseAssessmentDraft(actor, kind, clientId)).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("has_google_assessment_draft_access", {
      target_org_id: actor.organizationId, target_branch_id: actor.branchId,
      target_kind: kind, target_client_id: clientId,
    });
  });
  it("fails closed without exact role permissions, branch, or ordinary AAL1", async () => {
    expect(await canUseAssessmentDraft({ ...actor, scopes: ["clients.read"] }, "body", clientId)).toBe(false);
    expect(await canUseAssessmentDraft({ ...actor, branchId: "" }, "body", clientId)).toBe(false);
    expect(await canUseAssessmentDraft({ ...actor, assuranceLevel: "aal2" }, "body", clientId)).toBe(false);
    expect(await canUseAssessmentDraft({ ...actor, demo: true }, "body", clientId)).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("fails closed on revoked, unavailable, or malformed database result", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await canUseAssessmentDraft(actor, "body", clientId)).toBe(false);
    mocks.rpc.mockResolvedValue({ data: "true", error: null });
    expect(await canUseAssessmentDraft(actor, "body", clientId)).toBe(false);
    mocks.rpc.mockRejectedValue(new Error("private diagnostic"));
    expect(await canUseAssessmentDraft(actor, "body", clientId)).toBe(false);
    mocks.client.mockResolvedValue(null);
    expect(await canUseAssessmentDraft(actor, "body", clientId)).toBe(false);
  });
});

describe("body-only AAL2 signature preflight", () => {
  const signer = { ...actor, assuranceLevel: "aal2" as const,
    scopes: [...actor.scopes, "body_assessments.sign"] };
  it("asks only for live body signer evidence in the exact branch", async () => {
    expect(await hasRecentBodyAssessmentAal2(signer)).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("has_recent_body_assessment_aal2", {
      target_org_id: actor.organizationId,
      target_branch_id: actor.branchId,
    });
  });
  it("fails closed for AAL1, missing sign scope, demo, revoked or broken RPC", async () => {
    expect(await hasRecentBodyAssessmentAal2(actor)).toBe(false);
    expect(await hasRecentBodyAssessmentAal2({ ...signer, scopes: actor.scopes })).toBe(false);
    expect(await hasRecentBodyAssessmentAal2({ ...signer, demo: true })).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await hasRecentBodyAssessmentAal2(signer)).toBe(false);
    mocks.rpc.mockResolvedValue({ data: "true", error: null });
    expect(await hasRecentBodyAssessmentAal2(signer)).toBe(false);
    mocks.rpc.mockRejectedValue(new Error("private diagnostic"));
    expect(await hasRecentBodyAssessmentAal2(signer)).toBe(false);
  });
});
