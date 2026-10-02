import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  demo: vi.fn(), preview: vi.fn(), client: vi.fn(), getUser: vi.fn(), aal: vi.fn(), from: vi.fn(), rpc: vi.fn(), cookieGet: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo, isSyntheticPreviewMode: mocks.preview }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookieGet }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));

import { demoBranding } from "@/lib/config/branding";
import { getTenantContext, hasRecentAal2, requireTenantContext } from "./context";

const ORG = "58000000-0000-4000-8000-000000000901";
const BRANCH = "58000000-0000-4000-8000-000000000902";
const USER = "58000000-0000-4000-8000-000000000903";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

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
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.cookieGet.mockReturnValue(undefined);
  mocks.client.mockResolvedValue({
    auth: { getUser: mocks.getUser, mfa: { getAuthenticatorAssuranceLevel: mocks.aal } },
    from: mocks.from,
    rpc: mocks.rpc,
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

  it("does not start admission or assurance before getUser verifies a session", async () => {
    const identity = deferred<{ data: { user: { id: string } }; error: null }>();
    mocks.getUser.mockReturnValue(identity.promise);

    const result = getTenantContext("staff");
    await Promise.resolve();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.aal).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();

    identity.resolve({ data: { user: { id: USER } }, error: null });
    await expect(result).resolves.toMatchObject({ userId: USER, assuranceLevel: "aal2" });
  });

  it("starts both preflights together but waits for admission before tenant reads", async () => {
    const admission = deferred<{ data: true; error: null }>();
    const assurance = deferred<{ data: { currentLevel: "aal2" } }>();
    mocks.rpc.mockReturnValue(admission.promise);
    mocks.aal.mockReturnValue(assurance.promise);

    const result = getTenantContext("staff");
    await vi.waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith("is_staff_login_allowed");
      expect(mocks.aal).toHaveBeenCalledTimes(1);
    });
    expect(mocks.from).not.toHaveBeenCalled();

    assurance.resolve({ data: { currentLevel: "aal2" } });
    await Promise.resolve();
    expect(mocks.from).not.toHaveBeenCalled();

    admission.resolve({ data: true, error: null });
    await expect(result).resolves.toMatchObject({ userId: USER, assuranceLevel: "aal2" });
    expect(mocks.from).toHaveBeenCalledWith("active_memberships");
  });

  it("finishes two equal-duration preflights in one wait window", async () => {
    vi.useFakeTimers();
    try {
      mocks.rpc.mockImplementation(() => new Promise((resolve) => {
        setTimeout(() => resolve({ data: true, error: null }), 50);
      }));
      mocks.aal.mockImplementation(() => new Promise((resolve) => {
        setTimeout(() => resolve({ data: { currentLevel: "aal2" } }), 50);
      }));

      const result = getTenantContext("staff");
      await vi.advanceTimersByTimeAsync(49);
      expect(mocks.from).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toMatchObject({ userId: USER, assuranceLevel: "aal2" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps denial and policy errors closed even if assurance succeeds", async () => {
    const denied = deferred<{ data: false; error: null }>();
    mocks.rpc.mockReturnValueOnce(denied.promise);
    const deniedResult = getTenantContext("staff");
    await vi.waitFor(() => expect(mocks.aal).toHaveBeenCalledTimes(1));
    denied.resolve({ data: false, error: null });
    await expect(deniedResult).resolves.toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();

    const failed = deferred<{ data: true; error: null }>();
    mocks.rpc.mockReturnValueOnce(failed.promise);
    const failedResult = getTenantContext("staff");
    failed.reject(new Error("private policy detail"));
    await expect(failedResult).resolves.toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not query tenant data when assurance itself fails after admission", async () => {
    mocks.aal.mockRejectedValue(new Error("assurance unavailable"));
    await expect(getTenantContext("staff")).rejects.toThrow("assurance unavailable");
    expect(mocks.rpc).toHaveBeenCalledWith("is_staff_login_allowed");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not substitute a pilot name for a missing organization", async () => {
    setDatabaseNames(null);
    expect(await getTenantContext("staff")).toBeNull();
  });

  it("starts organization lookup while the admitted branch lookup is still pending", async () => {
    const branch = deferred<{ data: { id: string; name: string }[]; error: null }>();
    let organizationStarted = false;
    mocks.from.mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      returns: vi.fn().mockImplementation(() => table === "branches" ? branch.promise : Promise.resolve({ data: [{ organization_id: ORG, branch_id: BRANCH, display_name: "合成使用者", role_keys: ["branch_supervisor"], scopes: ["branch:read"] }], error: null })),
      maybeSingle: vi.fn().mockImplementation(() => { organizationStarted = true; return Promise.resolve({ data: { name: "合成機構" }, error: null }); }),
    }));

    const resultPromise = getTenantContext("staff");
    await vi.waitFor(() => expect(organizationStarted).toBe(true));
    branch.resolve({ data: [{ id: BRANCH, name: "合成分支" }], error: null });

    await expect(resultPromise).resolves.toMatchObject({
      organizationId: ORG, branchId: BRANCH, organizationName: "合成機構", branchName: "合成分支",
      assuranceLevel: "aal2", roles: ["branch_supervisor"], scopes: ["branch:read"],
    });
  });

  it("still denies access when the parallel branch lookup fails", async () => {
    mocks.from.mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      returns: vi.fn().mockResolvedValue(table === "branches"
        ? { data: null, error: { code: "PGRST000" } }
        : { data: [{ organization_id: ORG, branch_id: BRANCH, display_name: "合成使用者", role_keys: ["branch_supervisor"], scopes: ["branch:read"] }], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: { name: "合成機構" }, error: null }),
    }));

    await expect(getTenantContext("staff")).resolves.toBeNull();
  });

  it("falls back only within the selected organization for an organization-wide membership", async () => {
    const requestedBranch = "58000000-0000-4000-8000-000000000904";
    mocks.cookieGet.mockImplementation((name: string) => name === "daycare_branch" ? { value: requestedBranch } : undefined);
    const branchFilters: Array<Array<[string, string | boolean]>> = [];
    mocks.from.mockImplementation((table: string) => {
      const filters: Array<[string, string | boolean]> = [];
      const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockImplementation((key: string, value: string | boolean) => { filters.push([key, value]); return builder; }),
        order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
        returns: vi.fn().mockImplementation(() => {
          if (table === "active_memberships") return Promise.resolve({ data: [{ organization_id: ORG, branch_id: null, display_name: "合成使用者", role_keys: ["organization_admin"], scopes: ["branch:read"] }], error: null });
          branchFilters.push(filters);
          return Promise.resolve({ data: branchFilters.length === 1 ? [] : [{ id: BRANCH, name: "合成分支" }], error: null });
        }),
        maybeSingle: vi.fn().mockResolvedValue({ data: { name: "合成機構" }, error: null }),
      };
      return builder;
    });

    await expect(getTenantContext("staff")).resolves.toMatchObject({ organizationId: ORG, branchId: BRANCH });
    expect(branchFilters).toHaveLength(2);
    expect(branchFilters[0]).toEqual(expect.arrayContaining([["organization_id", ORG], ["id", requestedBranch], ["is_active", true]]));
    expect(branchFilters[1]).toEqual(expect.arrayContaining([["organization_id", ORG], ["is_active", true]]));
    expect(branchFilters[1]).not.toContainEqual(["id", requestedBranch]);
  });

  it("does not switch an exact branch membership to another branch", async () => {
    mocks.cookieGet.mockImplementation((name: string) => name === "daycare_branch" ? { value: BRANCH } : undefined);
    let branchReads = 0;
    mocks.from.mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      returns: vi.fn().mockImplementation(() => {
        if (table === "active_memberships") return Promise.resolve({ data: [{ organization_id: ORG, branch_id: BRANCH, display_name: "合成使用者", role_keys: ["branch_supervisor"], scopes: ["branch:read"] }], error: null });
        branchReads += 1;
        return Promise.resolve({ data: [], error: null });
      }),
      maybeSingle: vi.fn().mockResolvedValue({ data: { name: "合成機構" }, error: null }),
    }));

    await expect(getTenantContext("staff")).resolves.toBeNull();
    expect(branchReads).toBe(1);
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

  it.each([false, null, "true", 1])("denies a non-approved Google session: %s", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect(await getTenantContext("staff")).toBeNull();
    expect(await getTenantContext("family")).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("fails closed when the executive policy is missing or fails", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: { code: "PGRST202" } });
    expect(await getTenantContext("staff")).toBeNull();
    mocks.rpc.mockRejectedValue(new Error("private details"));
    expect(await getTenantContext("staff")).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("admits an approved AAL1 staff session without fabricating AAL2 or broadening its roles and scopes", async () => {
    mocks.aal.mockResolvedValue({ data: { currentLevel: "aal1" } });
    expect(await requireTenantContext("staff")).toMatchObject({
      userId: USER, organizationId: ORG, branchId: BRANCH,
      assuranceLevel: "aal1", recentAal2At: null, demo: false,
      roles: ["branch_supervisor"], scopes: ["branch:read"],
    });
    expect(mocks.rpc).toHaveBeenCalledWith("is_staff_login_allowed");
    expect(await hasRecentAal2()).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalledWith("has_recent_aal2", expect.anything());
  });

  it("does not promote an unavailable assurance result to AAL2", async () => {
    mocks.aal.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    expect(await requireTenantContext("staff")).toMatchObject({ assuranceLevel: "aal1", recentAal2At: null });
    expect(await hasRecentAal2()).toBe(false);
  });

  it("still redirects missing or unapproved sessions to the fixed login entrance", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(requireTenantContext("staff")).rejects.toThrow("REDIRECT:/login?audience=staff");
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(requireTenantContext("staff")).rejects.toThrow("REDIRECT:/login?audience=staff");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not admit staff membership through the family entrance", async () => {
    mocks.aal.mockResolvedValue({ data: { currentLevel: "aal1" } });
    await expect(requireTenantContext("family")).rejects.toThrow("REDIRECT:/login?audience=family");
  });

  it.each([true, false, null, "true"])("keeps the recent AAL2 evidence RPC authoritative (%s)", async (evidence) => {
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === "is_staff_login_allowed" ? true : evidence, error: null,
    }));
    expect(await hasRecentAal2()).toBe(evidence === true);
    expect(mocks.rpc).toHaveBeenCalledWith("has_recent_aal2", { max_age_minutes: 15 });
  });

  it("fails recent AAL2 closed on evidence RPC errors even if data is true", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: true,
      error: name === "has_recent_aal2" ? { code: "PGRST202" } : null,
    }));
    expect(await hasRecentAal2()).toBe(false);
  });
});
