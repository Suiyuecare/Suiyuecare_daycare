import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";

vi.mock("server-only", () => ({}));

const stubs = vi.hoisted(() => ({ context: vi.fn(), recentAal2: vi.fn(),
  supabaseConfigured: vi.fn(), synthetic: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: stubs.context, hasRecentAal2: stubs.recentAal2 }));
vi.mock("@/lib/env", () => ({ hasSupabaseConfiguration: stubs.supabaseConfigured, isSyntheticPreviewMode: stubs.synthetic }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn() }));

import { authorizeJuboReview, authorizeJuboReviewScope, canReviewJuboProfiles } from "./server";

const actor: TenantContext = { organizationId: "c1000000-0000-4000-8000-000000000001",
  branchId: "c2000000-0000-4000-8000-000000000001", userId: "c3000000-0000-4000-8000-000000000001",
  organizationName: "合成機構", branchName: "合成分支", displayName: "合成主管",
  roles: ["organization_manager"], scopes: ["clients.read", "clients.demographics.read", "clients.manage", "clients.view_all", "imports.approve"],
  assuranceLevel: "aal2", recentAal2At: null, demo: false };

beforeEach(() => {
  vi.stubEnv("JUBO_PROFILE_V2_REVIEW_ENABLED", "true");
  stubs.context.mockResolvedValue(actor); stubs.recentAal2.mockResolvedValue(true);
  stubs.supabaseConfigured.mockReturnValue(true); stubs.synthetic.mockReturnValue(false);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("is disabled unless the server-only review flag is explicitly true", async () => {
  vi.stubEnv("JUBO_PROFILE_V2_REVIEW_ENABLED", "false");
  await expect(authorizeJuboReview()).rejects.toMatchObject({ code: "JUBO_REVIEW_NOT_READY", httpStatus: 503 });
  expect(stubs.context).not.toHaveBeenCalled();
});
it("rejects synthetic, demo, unrelated staff and missing import scope", async () => {
  stubs.synthetic.mockReturnValue(true);
  await expect(authorizeJuboReview()).rejects.toMatchObject({ code: "JUBO_REVIEW_NOT_READY" });
  stubs.synthetic.mockReturnValue(false);
  expect(canReviewJuboProfiles({ ...actor, demo: true })).toBe(false);
  expect(canReviewJuboProfiles({ ...actor, roles: ["care_worker"] })).toBe(false);
  expect(canReviewJuboProfiles({ ...actor, scopes: ["clients.read"] })).toBe(false);
  expect(canReviewJuboProfiles(actor)).toBe(true);
  stubs.context.mockResolvedValue({ ...actor, scopes: ["clients.read"] });
  await expect(authorizeJuboReview()).rejects.toMatchObject({ code: "JUBO_REVIEW_DENIED", httpStatus: 403 });
});
it("requires both AAL2 and a recent same-session challenge", async () => {
  stubs.recentAal2.mockResolvedValue(false);
  await expect(authorizeJuboReview()).rejects.toMatchObject({ code: "JUBO_REAUTH_REQUIRED", httpStatus: 403 });
  stubs.recentAal2.mockResolvedValue(true);
  stubs.context.mockResolvedValue({ ...actor, assuranceLevel: "aal1" });
  await expect(authorizeJuboReview()).rejects.toMatchObject({ code: "JUBO_REAUTH_REQUIRED", httpStatus: 403 });
  stubs.context.mockResolvedValue(actor);
  await expect(authorizeJuboReview()).resolves.toBe(actor);
});
it("permits only the same scoped manager to query an old receipt after AAL2 expires", async () => {
  stubs.context.mockResolvedValue({ ...actor, assuranceLevel: "aal1" });
  stubs.recentAal2.mockResolvedValue(false);
  await expect(authorizeJuboReviewScope()).resolves.toMatchObject({ userId: actor.userId });
  expect(stubs.recentAal2).not.toHaveBeenCalled();
  await expect(authorizeJuboReview()).rejects.toMatchObject({ code: "JUBO_REAUTH_REQUIRED" });
  stubs.context.mockResolvedValue({ ...actor, assuranceLevel: "aal1", roles: ["care_worker"] });
  await expect(authorizeJuboReviewScope()).rejects.toMatchObject({ code: "JUBO_REVIEW_DENIED" });
});
