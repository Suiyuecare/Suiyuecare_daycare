import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), aal: vi.fn(), rpc: vi.fn(), from: vi.fn(), cookies: vi.fn(), redirect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isDemoMode: () => false, isSyntheticPreviewMode: () => false }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import { getTenantContext, hasRecentAal2, requireTenantContext } from "./context";
import { SERVER_WORKSPACE_READ_TIMEOUT_MS } from "@/lib/api/server-read-deadline";

const ORG = "59000000-0000-4000-8000-000000000001";
const BRANCH = "59000000-0000-4000-8000-000000000002";
const USER = "59000000-0000-4000-8000-000000000003";
const membership = { organization_id: ORG, branch_id: BRANCH, display_name: "合成主管", role_keys: ["branch_supervisor"], scopes: ["clients.read"] };
const queries = new Map<string, ReturnType<typeof builder>>();
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function builder(data: unknown) {
  return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    returns: vi.fn().mockResolvedValue({ data, error: null }), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }) };
}
const db = { auth: { getUser: mocks.user, mfa: { getAuthenticatorAssuranceLevel: mocks.aal } }, rpc: mocks.rpc, from: mocks.from };
const cookieStore = { get: (key: string) => key === "daycare_organization" ? { value: ORG } : key === "daycare_branch" ? { value: BRANCH } : undefined };
async function tick() { await vi.advanceTimersByTimeAsync(0); }
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); queries.clear();
  mocks.client.mockResolvedValue(db); mocks.cookies.mockResolvedValue(cookieStore);
  mocks.user.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  mocks.aal.mockResolvedValue({ data: { currentLevel: "aal2" } });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.redirect.mockImplementation((url) => { throw new Error(`REDIRECT:${url}`); });
  mocks.from.mockImplementation((table) => {
    const query = builder(table === "active_memberships" ? [membership] : table === "branches" ? [{ id: BRANCH, name: "合成分支" }] : { name: "合成機構" });
    queries.set(table, query); return query;
  });
});
afterEach(() => { vi.useRealTimers(); });

describe("request-owned authority deadline", () => {
  it.each([new AuthRetryableFetchError("synthetic transport unavailable", 0), new AuthApiError("synthetic authority unavailable", 503, "unexpected_failure")])("reports immediate authority failure as unavailable without login redirect (%s)", async (error) => {
    mocks.user.mockResolvedValue({ data: { user: null }, error });
    await expect(requireTenantContext()).rejects.toMatchObject({ code: "AUTH_CONTEXT_UNAVAILABLE", httpStatus: 503 });
    expect(mocks.redirect).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([new AuthSessionMissingError(), new AuthApiError("synthetic invalid token", 401, "bad_jwt")])("keeps known invalid or missing session denied (%s)", async (error) => {
    mocks.user.mockResolvedValue({ data: { user: null }, error });
    expect(await getTenantContext()).toBeNull(); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it("preserves identity and every selected organization/branch filter", async () => {
    expect(await getTenantContext()).toMatchObject({ organizationId: ORG, branchId: BRANCH, userId: USER, assuranceLevel: "aal2", recentAal2At: null, demo: false });
    expect(mocks.client).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
    expect(queries.get("active_memberships")!.eq).toHaveBeenCalledWith("user_id", USER);
    expect(queries.get("active_memberships")!.eq).toHaveBeenCalledWith("organization_id", ORG);
    expect(queries.get("branches")!.eq).toHaveBeenCalledWith("organization_id", ORG);
    expect(queries.get("branches")!.eq).toHaveBeenCalledWith("id", BRANCH);
    expect(queries.get("organizations")!.eq).toHaveBeenCalledWith("id", ORG);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("loads assurance and membership together only after actual user and admission", async () => {
    const assurance = deferred<{ data: { currentLevel: string } }>();
    mocks.aal.mockReturnValue(assurance.promise);
    const result = getTenantContext(); await tick();
    expect(mocks.user).toHaveBeenCalledTimes(1); expect(mocks.rpc).toHaveBeenCalledWith("is_staff_login_allowed");
    expect(mocks.aal).toHaveBeenCalledTimes(1); expect(mocks.from).toHaveBeenCalledWith("active_memberships");
    expect(mocks.from).not.toHaveBeenCalledWith("branches");
    assurance.resolve({ data: { currentLevel: "aal2" } }); await result;
  });
  it("starts branch and organization queries together and does not adopt an unresolved branch", async () => {
    const branch = deferred<{ data: Array<{ id: string; name: string }>; error: null }>();
    mocks.from.mockImplementation((table) => {
      const query = builder(table === "active_memberships" ? [membership] : { name: "合成機構" });
      if (table === "branches") query.returns.mockReturnValue(branch.promise);
      queries.set(table, query); return query;
    });
    const result = getTenantContext(); await tick();
    expect(mocks.from).toHaveBeenCalledWith("branches"); expect(mocks.from).toHaveBeenCalledWith("organizations");
    branch.resolve({ data: [{ id: BRANCH, name: "合成分支" }], error: null }); expect(await result).toMatchObject({ branchId: BRANCH });
  });
  it.each(["client", "user", "admission", "assurance", "membership", "branch", "organization"])("bounds stalled %s and discards late completion", async (step) => {
    const late = deferred<unknown>();
    if (step === "client") mocks.client.mockReturnValue(late.promise);
    if (step === "user") mocks.user.mockReturnValue(late.promise);
    if (step === "admission") mocks.rpc.mockReturnValue(late.promise);
    if (step === "assurance") mocks.aal.mockReturnValue(late.promise);
    if (["membership", "branch", "organization"].includes(step)) {
      mocks.from.mockImplementation((table) => {
        const query = builder(table === "active_memberships" ? [membership] : table === "branches" ? [{ id: BRANCH, name: "合成分支" }] : { name: "合成機構" });
        if (table === ({ membership: "active_memberships", branch: "branches", organization: "organizations" } as Record<string, string>)[step]) {
          if (table === "organizations") query.maybeSingle.mockReturnValue(late.promise); else query.returns.mockReturnValue(late.promise);
        }
        return query;
      });
    }
    const result = getTenantContext();
    const assertion = expect(result).rejects.toMatchObject({ code: "AUTH_CONTEXT_UNAVAILABLE", httpStatus: 503 });
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS); await assertion;
    const before = { user: mocks.user.mock.calls.length, rpc: mocks.rpc.mock.calls.length, from: mocks.from.mock.calls.length };
    late.resolve(step === "client" ? db : step === "user" ? { data: { user: { id: USER } }, error: null }
      : step === "admission" ? { data: true, error: null } : step === "assurance" ? { data: { currentLevel: "aal2" } }
      : { data: step === "membership" ? [membership] : step === "branch" ? [{ id: BRANCH, name: "合成分支" }] : { name: "合成機構" }, error: null });
    await tick();
    expect({ user: mocks.user.mock.calls.length, rpc: mocks.rpc.mock.calls.length, from: mocks.from.mock.calls.length }).toEqual(before);
    expect(mocks.client.mock.calls[0][0].signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not create membership queries when cookie initialization finishes after expiry", async () => {
    const late = deferred<typeof cookieStore>(); mocks.cookies.mockReturnValue(late.promise);
    const result = getTenantContext(); const assertion = expect(result).rejects.toMatchObject({ httpStatus: 503 });
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS); await assertion;
    late.resolve(cookieStore); await tick(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it("keeps known denied admission and missing session null without further reads", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null }); expect(await getTenantContext()).toBeNull(); expect(mocks.from).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ data: { user: null }, error: null }); expect(await getTenantContext()).toBeNull(); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not redirect a timed-out session to login", async () => {
    mocks.user.mockReturnValue(new Promise(() => {})); const result = requireTenantContext();
    const assertion = expect(result).rejects.toMatchObject({ code: "AUTH_CONTEXT_UNAVAILABLE", httpStatus: 503 });
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS); await assertion; expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("does not complete context from a nursing result returned after expiry", async () => {
    const nurse = { ...membership, role_keys: ["nurse"], scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.sign"] };
    const late = deferred<unknown>();
    mocks.from.mockImplementation((table) => builder(table === "active_memberships" ? [nurse] : table === "branches" ? [{ id: BRANCH, name: "合成分支" }] : { name: "合成機構" }));
    mocks.rpc.mockImplementation((name) => name === "nursing_recent_aal2_evidence" ? late.promise : Promise.resolve({ data: true, error: null }));
    const result = getTenantContext(); const assertion = expect(result).rejects.toMatchObject({ httpStatus: 503 });
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS); await assertion;
    late.resolve({ data: { organizationId: ORG, branchId: BRANCH, actorUserId: USER, verifiedAt: new Date().toISOString() }, error: null });
    await tick(); expect(vi.getTimerCount()).toBe(0);
  });
  it("recent assurance has one total budget including context, not another20s per stage", async () => {
    const user = deferred<unknown>(); const late = deferred<unknown>(); mocks.user.mockReturnValue(user.promise);
    mocks.rpc.mockImplementation((name) => name === "has_recent_aal2" ? late.promise : Promise.resolve({ data: true, error: null }));
    const result = hasRecentAal2(); const assertion = expect(result).rejects.toMatchObject({ code: "AUTH_CONTEXT_UNAVAILABLE", httpStatus: 503 });
    await vi.advanceTimersByTimeAsync(10_000); user.resolve({ data: { user: { id: USER } }, error: null }); await tick();
    expect(mocks.rpc).toHaveBeenCalledWith("has_recent_aal2", { max_age_minutes: 15 });
    await vi.advanceTimersByTimeAsync(10_000); await assertion;
    expect(mocks.client.mock.calls.at(-1)![0].signal.aborted).toBe(true);
    late.resolve({ data: true, error: null }); await tick(); expect(vi.getTimerCount()).toBe(0);
  });
});
