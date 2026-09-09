import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { GOOGLE_LOGIN_ENABLED: true, NODE_ENV: "production", NEXT_PUBLIC_APP_ORIGIN: "https://daycare.example.test", NEXT_PUBLIC_SUPABASE_URL: "https://auth-project.supabase.co" },
  demo: false, synthetic: false, server: vi.fn(), exchange: vi.fn(), getUser: vi.fn(), getClaims: vi.fn(), rpc: vi.fn(), signOut: vi.fn(),
  cookieValues: new Map<string, string>(), setCookie: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: mocks.env, isDemoMode: () => mocks.demo, isSyntheticPreviewMode: () => mocks.synthetic }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.server }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => mocks.cookieValues.has(name) ? { value: mocks.cookieValues.get(name) } : undefined,
  getAll: () => Array.from(mocks.cookieValues, ([name, value]) => ({ name, value })),
  set: mocks.setCookie,
}) }));
import { GET } from "./route";
import { GOOGLE_FLOW_COOKIE, GOOGLE_LOGIN_FAILURE, newGoogleFlowMarker } from "@/lib/auth/google-login";

const APP = "https://daycare.example.test";
const FLOW = "1234567890abcdef1234567890abcdef";
const USER = "58000000-0000-4000-8000-000000000301";
const CLAIMS = { sub: USER, iss: "https://auth-project.supabase.co/auth/v1", role: "authenticated", amr: [{ method: "oauth", timestamp: 1780000000 }], aal: "aal1" };
const AUTH_USER = { id: USER, is_anonymous: false, identities: [{ provider: "google" }] };
function request(query = "code=synthetic-pkce-code", origin = APP) {
  return new Request(`${origin}/auth/callback${query ? `?${query}` : ""}`);
}
async function expectDenied(response: Response) {
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(GOOGLE_LOGIN_FAILURE);
  expect(response.headers.get("cache-control")).toContain("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(await response.text()).toBe("");
}

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(mocks.env, { GOOGLE_LOGIN_ENABLED: true, NODE_ENV: "production", NEXT_PUBLIC_APP_ORIGIN: APP, NEXT_PUBLIC_SUPABASE_URL: "https://auth-project.supabase.co" });
  mocks.demo = false; mocks.synthetic = false;
  mocks.cookieValues.clear();
  mocks.cookieValues.set(GOOGLE_FLOW_COOKIE, newGoogleFlowMarker(FLOW)!);
  mocks.setCookie.mockImplementation((name: string, value: string) => mocks.cookieValues.set(name, value));
  mocks.exchange.mockResolvedValue({ data: { session: {} }, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });
  mocks.getClaims.mockResolvedValue({ data: { claims: CLAIMS }, error: null });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.server.mockResolvedValue({ auth: { exchangeCodeForSession: mocks.exchange, getUser: mocks.getUser, getClaims: mocks.getClaims, signOut: mocks.signOut }, rpc: mocks.rpc });
});

describe("CEO-only Google PKCE callback", () => {
  it("verifies flow-bound PKCE, user/claims and self-only allowlist, then admits the actual AAL1 Google session to the dashboard", async () => {
    const response = await GET(request());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/app/dashboard");
    expect(CLAIMS.aal).toBe("aal1");
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.exchange).toHaveBeenCalledExactlyOnceWith("synthetic-pkce-code", { flowId: FLOW });
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("is_executive_login_allowed");
    expect(mocks.exchange.mock.invocationCallOrder[0]).toBeLessThan(mocks.getUser.mock.invocationCallOrder[0]!);
    expect(mocks.getUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.getClaims.mock.invocationCallOrder[0]!);
    expect(mocks.getClaims.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]!);
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.setCookie).toHaveBeenCalledWith(GOOGLE_FLOW_COOKIE, "", expect.objectContaining({ maxAge: 0, httpOnly: true, secure: true, path: "/" }));
  });

  it.each([undefined, "malformed", `${Math.floor(Date.now() / 1000) - 600}.${FLOW}`, `${Math.floor(Date.now() / 1000) + 60}.${FLOW}`])("rejects missing, expired or invalid initiation state before exchange", async (marker) => {
    if (marker === undefined) mocks.cookieValues.delete(GOOGLE_FLOW_COOKIE);
    else mocks.cookieValues.set(GOOGLE_FLOW_COOKIE, marker);
    await expectDenied(await GET(request()));
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it.each([
    "", "code=", "code=one&code=two", "code=with%20space", "code=one&state=untrusted",
    "state=untrusted", "code=one&next=https://evil.example", "code=one&next=//evil.example",
    "code=one&redirect_to=https://evil.example", "code=one&role=admin", "code=one&audience=family",
    "error=access_denied&error_description=private-provider-token", "code=one&email=private@example.test",
  ])("rejects invalid code/state and all user-selected destinations or privilege parameters: %s", async (query) => {
    await expectDenied(await GET(request(query)));
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });

  it("rejects an oversized code without Auth exchange", async () => {
    await expectDenied(await GET(request(`code=${"a".repeat(2049)}`)));
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it("rejects a callback for an unconfigured host without reflecting that host", async () => {
    await expectDenied(await GET(request("code=synthetic", "https://evil.example")));
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it.each(["disabled", "demo", "synthetic", "no-client"])("fails closed when %s", async (state) => {
    if (state === "disabled") mocks.env.GOOGLE_LOGIN_ENABLED = false;
    if (state === "demo") mocks.demo = true;
    if (state === "synthetic") mocks.synthetic = true;
    if (state === "no-client") mocks.server.mockResolvedValue(null);
    await expectDenied(await GET(request()));
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it.each(["missing-verifier", "wrong-verifier", "expired-code", "replayed-code", "invalid-provider-state"])("signs out and fails closed on SDK %s", async (reason) => {
    mocks.exchange.mockResolvedValue({ data: null, error: { message: `private-provider-token:${reason}` } });
    await expectDenied(await GET(request()));
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });

  it.each([
    { data: { user: null }, error: null },
    { data: { user: AUTH_USER }, error: { message: "private-user-error" } },
    { data: { user: { ...AUTH_USER, is_anonymous: true } }, error: null },
    { data: { user: { id: USER, identities: [{ provider: "email" }] } }, error: null },
    { data: { user: { id: USER, user_metadata: { provider: "google", role: "admin" } } }, error: null },
  ])("rejects unverified, anonymous, non-Google or user-editable identity claims", async (result) => {
    mocks.getUser.mockResolvedValue(result);
    await expectDenied(await GET(request()));
    expect(mocks.getClaims).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it.each([
    { sub: "other-user" }, { iss: "https://other-project.supabase.co/auth/v1" }, { role: "service_role" },
    { is_anonymous: true }, { amr: [{ method: "password" }] }, { amr: ["oauth"] }, { amr: [null] }, { amr: null },
  ])("rejects mismatched or non-OAuth verified claims", async (override) => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { ...CLAIMS, ...override } }, error: null });
    await expectDenied(await GET(request()));
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("rejects failed claim verification", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: CLAIMS }, error: { message: "private-token-claims" } });
    await expectDenied(await GET(request()));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([false, null, undefined, "true", 1, { allowed: true }, [true]])("authorizes only literal true from the pinned-identity RPC (%j)", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expectDenied(await GET(request()));
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });

  it("rejects a missing or failed allowlist RPC even when data is true", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: { code: "PGRST202", message: "private-allowlist-detail" } });
    await expectDenied(await GET(request()));
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("clears only this project's complete and chunked Auth/PKCE cookies even if sign-out fails", async () => {
    const scoped = ["sb-auth-project-auth-token", "sb-auth-project-auth-token.0", "sb-auth-project-auth-token-code-verifier", `sb-auth-project-auth-token-flow-${FLOW}-code-verifier`, "sb-auth-project-auth-token-flows-code-verifier"];
    const unrelated = ["sb-other-auth-token", "daycare_branch", "sb-auth-project-auth-token-not-a-session"];
    for (const name of [...scoped, ...unrelated]) mocks.cookieValues.set(name, "synthetic-cookie");
    mocks.rpc.mockRejectedValue(new Error("private-provider-token"));
    mocks.signOut.mockRejectedValue(new Error("private-signout-error"));
    await expectDenied(await GET(request()));
    for (const name of scoped) expect(mocks.cookieValues.get(name)).toBe("");
    for (const name of unrelated) expect(mocks.cookieValues.get(name)).toBe("synthetic-cookie");
  });

  it("consumes the initiation marker so refreshing the callback cannot exchange again", async () => {
    expect((await GET(request())).headers.get("location")).toBe("/app/dashboard");
    await expectDenied(await GET(request()));
    expect(mocks.exchange).toHaveBeenCalledOnce();
  });

  it("does not print provider errors or session tokens", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.exchange.mockRejectedValue(new Error("private-provider-token"));
    await expectDenied(await GET(request()));
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
    log.mockRestore(); error.mockRestore(); warn.mockRestore();
  });
});
