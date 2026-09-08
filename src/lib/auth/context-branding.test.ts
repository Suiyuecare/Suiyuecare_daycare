import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  demo: vi.fn(), preview: vi.fn(), client: vi.fn(), getUser: vi.fn(), aal: vi.fn(), from: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo, isSyntheticPreviewMode: mocks.preview }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { demoBranding } from "@/lib/config/branding";
import { getTenantContext } from "./context";

const ORG = "58000000-0000-4000-8000-000000000901";
const BRANCH = "58000000-0000-4000-8000-000000000902";
const USER = "58000000-0000-4000-8000-000000000903";

function setDatabaseNames(organization: { name: string } | null = { name: "另一間授權合成機構" }) {
  const queries = new Map<string, { eq: ReturnType<typeof vi.fn> }>();
  mocks.from.mockImplementation((table: string) => {
    const result = table === "active_memberships"
      ? [{ organization_id: ORG, branch_id: BRANCH, display_name: "合成使用者",
        role_keys: ["branch_supervisor"], scopes: ["branch:read"] }]
      : [{ id: BRANCH, name: "另一個授權合成分支" }];
    const builder = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      returns: vi.fn().mockResolvedValue({ data: result, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: organization, error: null }),
    };
    queries.set(table, builder);
    return builder;
  });
  return queries;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.demo.mockReturnValue(false);
  mocks.preview.mockReturnValue(false);
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  mocks.aal.mockResolvedValue({ data: { currentLevel: "aal2" } });
  mocks.client.mockResolvedValue({
    auth: { getUser: mocks.getUser, mfa: { getAuthenticatorAssuranceLevel: mocks.aal } },
    from: mocks.from,
  });
  setDatabaseNames();
});

describe("branding cannot replace authenticated tenant identity", () => {
  it("keeps online preview identity fixed and separate from actual authentication", async () => {
    mocks.preview.mockReturnValue(true);
    expect(await getTenantContext("staff")).toMatchObject({
      userId: "33333333-3333-4333-8333-333333333333", displayName: "合成員工檢視者",
      demo: true, recentAal2At: null,
    });
    expect(await getTenantContext("family")).toMatchObject({
      userId: "44444444-4444-4444-8444-444444444444", displayName: "合成家屬檢視者",
      roles: ["family"], demo: true, recentAal2At: null,
    });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("uses marked synthetic branding only in demo mode without database access", async () => {
    mocks.demo.mockReturnValue(true);
    expect(await getTenantContext("staff")).toMatchObject({
      organizationName: demoBranding.organizationName, branchName: demoBranding.branchName,
      demo: true,
    });
    expect(await getTenantContext("family")).toMatchObject({
      organizationName: demoBranding.organizationName, branchName: demoBranding.branchName,
      roles: ["family"], demo: true,
    });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("retains real-mode database names, IDs and membership filters", async () => {
    const queries = setDatabaseNames();
    expect(await getTenantContext("staff")).toMatchObject({
      organizationId: ORG, branchId: BRANCH, userId: USER,
      organizationName: "另一間授權合成機構", branchName: "另一個授權合成分支",
      roles: ["branch_supervisor"], scopes: ["branch:read"],
      assuranceLevel: "aal2", recentAal2At: null, demo: false,
    });
    expect(queries.get("active_memberships")!.eq).toHaveBeenCalledWith("user_id", USER);
    expect(queries.get("branches")!.eq).toHaveBeenCalledWith("organization_id", ORG);
    expect(queries.get("branches")!.eq).toHaveBeenCalledWith("id", BRANCH);
    expect(queries.get("organizations")!.eq).toHaveBeenCalledWith("id", ORG);
  });

  it("does not substitute a pilot name for a missing organization", async () => {
    setDatabaseNames(null);
    expect(await getTenantContext("staff")).toBeNull();
  });

  it("does not supply pilot or demo data when the backend is unconfigured", async () => {
    mocks.client.mockResolvedValue(null);
    expect(await getTenantContext("staff")).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not supply identity data to an unauthenticated request", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await getTenantContext("staff")).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
