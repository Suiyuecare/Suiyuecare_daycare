import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), recent: vi.fn(), bodyRecent: vi.fn(), routine: vi.fn(), draft: vi.fn(), configured: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.actor, hasRecentAal2: mocks.recent }));
vi.mock("@/lib/auth/routine-care", () => ({ canUseRoutineCare: mocks.routine }));
vi.mock("@/lib/auth/assessment-draft", () => ({ canUseAssessmentDraft: mocks.draft,
  hasRecentBodyAssessmentAal2: mocks.bodyRecent }));
vi.mock("@/lib/env", () => ({ isDemoMode: () => false, hasSupabaseConfiguration: mocks.configured, hasSupabaseAdminConfiguration: () => false }));
import { authorizeStaffRequest, requireRecentAal2,
  requireRecentBodyAssessmentAal2 } from "./http";

const actor: TenantContext = { organizationId: "org", organizationName: "合成機構", branchId: "branch", branchName: "合成分支",
  userId: "user", displayName: "合成照服員", roles: ["care_worker"], scopes: ["health.write"], assuranceLevel: "aal1", recentAal2At: null, demo: false };
beforeEach(() => { vi.resetAllMocks(); mocks.configured.mockReturnValue(true); mocks.actor.mockResolvedValue(actor); mocks.routine.mockResolvedValue(true); mocks.draft.mockResolvedValue(true); mocks.recent.mockResolvedValue(true); mocks.bodyRecent.mockResolvedValue(true); });
describe("API routine exceptions remain opt-in per endpoint", () => {
  it("allows explicitly classified routine work with verified grant, retaining AAL1", async () => {
    expect(await authorizeStaffRequest({ routinePermission: "health.write" })).toBe(actor);
    expect(mocks.routine).toHaveBeenCalledExactlyOnceWith(actor, "health.write");
    expect(actor.assuranceLevel).toBe("aal1");
  });
  it("keeps every unclassified endpoint protected, even if a routine grant would allow", async () => {
    await expect(authorizeStaffRequest()).rejects.toMatchObject({ code: "AAL2_REQUIRED", httpStatus: 403 });
    expect(mocks.routine).not.toHaveBeenCalled();
  });
  it("allows only an explicitly classified Google assessment draft after live preflight", async () => {
    expect(await authorizeStaffRequest({ assessmentDraft: "body" })).toBe(actor);
    expect(mocks.draft).toHaveBeenCalledExactlyOnceWith(actor, "body");
    expect(mocks.routine).not.toHaveBeenCalled();
    mocks.draft.mockResolvedValue(false);
    await expect(authorizeStaffRequest({ assessmentDraft: "behavior" })).rejects.toMatchObject({
      code: "ASSESSMENT_DRAFT_NOT_AUTHORIZED", httpStatus: 403,
    });
  });
  it("denies an unapproved routine account with a practical message", async () => {
    mocks.routine.mockResolvedValue(false);
    await expect(authorizeStaffRequest({ routinePermission: "health.write" })).rejects.toMatchObject({ code: "ROUTINE_CARE_NOT_AUTHORIZED", httpStatus: 403 });
  });
  it("cannot use a routine grant as recent-signature evidence", async () => {
    await expect(requireRecentAal2(actor)).rejects.toMatchObject({ code: "AAL2_REQUIRED" });
    expect(mocks.recent).not.toHaveBeenCalled();
  });
  it("uses only the body-specific live factor preflight for body signing", async () => {
    const bodySigner = { ...actor, assuranceLevel: "aal2" as const };
    await expect(requireRecentBodyAssessmentAal2(bodySigner)).resolves.toBeUndefined();
    expect(mocks.bodyRecent).toHaveBeenCalledExactlyOnceWith(bodySigner);
    expect(mocks.recent).not.toHaveBeenCalled();
    mocks.bodyRecent.mockResolvedValue(false);
    await expect(requireRecentBodyAssessmentAal2(bodySigner)).rejects.toMatchObject({
      code: "AAL2_REQUIRED", httpStatus: 403,
    });
  });
  it("rejects unauthenticated and unconfigured requests before grant checks", async () => {
    mocks.actor.mockResolvedValue(null);
    await expect(authorizeStaffRequest({ routinePermission: "health.write" })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    mocks.configured.mockReturnValue(false);
    await expect(authorizeStaffRequest({ routinePermission: "health.write" })).rejects.toMatchObject({ code: "SERVICE_NOT_CONFIGURED" });
    expect(mocks.routine).not.toHaveBeenCalled();
  });
  it("preserves AAL2 path and branch requirement", async () => {
    mocks.actor.mockResolvedValue({ ...actor, assuranceLevel: "aal2" });
    expect(await authorizeStaffRequest()).toMatchObject({ assuranceLevel: "aal2" });
    mocks.actor.mockResolvedValue({ ...actor, assuranceLevel: "aal2", branchId: "" });
    await expect(authorizeStaffRequest()).rejects.toMatchObject({ code: "BRANCH_CONTEXT_REQUIRED" });
    expect(mocks.routine).not.toHaveBeenCalled();
  });
});
