import { beforeEach, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  context: vi.fn(), recent: vi.fn(), feature: vi.fn(), allowed: vi.fn(),
  synthetic: vi.fn(), configured: vi.fn(),
}));
vi.mock("next/navigation", () => ({ notFound: stubs.notFound }));
vi.mock("@/lib/auth/context", () => ({ requireTenantContext: stubs.context, hasRecentAal2: stubs.recent }));
vi.mock("@/lib/env", () => ({ isSyntheticPreviewMode: stubs.synthetic, hasSupabaseConfiguration: stubs.configured }));
vi.mock("@/lib/jubo-review/server", () => ({ juboReviewFeatureEnabled: stubs.feature, canReviewJuboProfiles: stubs.allowed }));
vi.mock("@/components/jubo-review/jubo-profile-review-workspace", () => ({ JuboProfileReviewWorkspace: () => null }));

import JuboProfileReviewPage from "./page";

const actor = { organizationId: "d1000000-0000-4000-8000-000000000001",
  branchId: "d2000000-0000-4000-8000-000000000001", userId: "d3000000-0000-4000-8000-000000000001",
  branchName: "合成分支", assuranceLevel: "aal2" };

beforeEach(() => {
  vi.clearAllMocks(); stubs.feature.mockReturnValue(true); stubs.synthetic.mockReturnValue(false);
  stubs.configured.mockReturnValue(true); stubs.allowed.mockReturnValue(true);
  stubs.context.mockResolvedValue(actor); stubs.recent.mockResolvedValue(true);
});

it("hides the direct route while the candidate feature flag is off", async () => {
  stubs.feature.mockReturnValue(false);
  await expect(JuboProfileReviewPage()).rejects.toThrow("NOT_FOUND");
  expect(stubs.context).not.toHaveBeenCalled();
});
it("does not expose preview data to synthetic mode or a non-manager", async () => {
  stubs.synthetic.mockReturnValue(true);
  await expect(JuboProfileReviewPage()).rejects.toThrow("NOT_FOUND");
  stubs.synthetic.mockReturnValue(false); stubs.allowed.mockReturnValue(false);
  await expect(JuboProfileReviewPage()).rejects.toThrow("NOT_FOUND");
  expect(stubs.recent).not.toHaveBeenCalled();
});
it("passes only recent-AAL2 readiness and remounts by principal + branch", async () => {
  const page = await JuboProfileReviewPage();
  expect(page.props).toEqual(expect.objectContaining({ branchName: "合成分支", recentAal2: true }));
  expect(page.key).toBe(`${actor.organizationId}:${actor.branchId}:${actor.userId}`);
  stubs.context.mockResolvedValue({ ...actor, branchId: "d2000000-0000-4000-8000-000000000002", assuranceLevel: "aal1" });
  const next = await JuboProfileReviewPage();
  expect(next.key).not.toBe(page.key);
  expect(next.props.recentAal2).toBe(false);
});
