import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { GOOGLE_LOGIN_ENABLED: true, NODE_ENV: "production", NEXT_PUBLIC_APP_ORIGIN: "https://daycare.example.test", NEXT_PUBLIC_SUPABASE_URL: "https://auth-project.supabase.co" },
  demo: false, synthetic: false, server: vi.fn(), oauth: vi.fn(), setCookie: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: mocks.env, isDemoMode: () => mocks.demo, isSyntheticPreviewMode: () => mocks.synthetic }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.server }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.setCookie }) }));
import { POST } from "./route";
import { GOOGLE_FLOW_COOKIE, GOOGLE_LOGIN_FAILURE } from "@/lib/auth/google-login";

const APP = "https://daycare.example.test";
const FLOW = "1234567890abcdef1234567890abcdef";
function authorizationUrl() {
  return `https://auth-project.supabase.co/auth/v1/authorize?${new URLSearchParams({
    provider: "google", redirect_to: `${APP}/auth/callback`, prompt: "select_account",
    code_challenge: "a".repeat(43), code_challenge_method: "s256",
  })}`;
}
function request(headers: HeadersInit = { origin: APP }, path = "/auth/google", origin = APP) {
  return new Request(`${origin}${path}`, { method: "POST", headers });
}
function expectPrivate(response: Response) {
  expect(response.status).toBe(303);
  expect(response.headers.get("cache-control")).toContain("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(mocks.env, { GOOGLE_LOGIN_ENABLED: true, NODE_ENV: "production", NEXT_PUBLIC_APP_ORIGIN: APP, NEXT_PUBLIC_SUPABASE_URL: "https://auth-project.supabase.co" });
  mocks.demo = false; mocks.synthetic = false;
  mocks.oauth.mockResolvedValue({ data: { provider: "google", url: authorizationUrl(), flowId: FLOW }, error: null });
  mocks.server.mockResolvedValue({ auth: { signInWithOAuth: mocks.oauth } });
});

describe("same-origin Google PKCE initiation", () => {
  it("uses fixed Google provider, callback and prompt, then issues a secure flow-bound marker", async () => {
    const response = await POST(request({ origin: APP, "sec-fetch-site": "same-origin" }));
    expectPrivate(response);
    expect(response.headers.get("location")).toBe(authorizationUrl());
    expect(mocks.oauth).toHaveBeenCalledExactlyOnceWith({ provider: "google", options: {
      redirectTo: `${APP}/auth/callback`, skipBrowserRedirect: true, queryParams: { prompt: "select_account" },
    } });
    expect(mocks.setCookie).toHaveBeenLastCalledWith(GOOGLE_FLOW_COOKIE, expect.stringMatching(new RegExp(`^\\d{10}\\.${FLOW}$`, "u")), {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600,
    });
    expect(await response.text()).toBe("");
  });

  it.each([
    {}, { origin: "https://evil.example" }, { origin: "null" }, { origin: `${APP}/path` },
    { origin: APP, "sec-fetch-site": "cross-site" }, { origin: APP, "sec-fetch-site": "same-site" },
  ])("rejects missing or cross-site Origin before touching Auth", async (headers) => {
    const response = await POST(request(Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"))));
    expectPrivate(response);
    expect(response.headers.get("location")).toBe(GOOGLE_LOGIN_FAILURE);
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it.each(["?next=https://evil.example", "?audience=family", "?role=admin", "?redirect_to=https://evil.example"])("rejects user-supplied initiation parameters: %s", async (query) => {
    expect((await POST(request(undefined, `/auth/google${query}`))).headers.get("location")).toBe(GOOGLE_LOGIN_FAILURE);
    expect(mocks.oauth).not.toHaveBeenCalled();
  });

  it("does not trust forwarded-host to make an unconfigured host eligible", async () => {
    const response = await POST(request({ origin: APP, "x-forwarded-host": "daycare.example.test" }, "/auth/google", "https://evil.example"));
    expect(response.headers.get("location")).toBe(GOOGLE_LOGIN_FAILURE);
    expect(mocks.oauth).not.toHaveBeenCalled();
  });

  it.each(["disabled", "demo", "synthetic", "missing-origin", "invalid-origin", "insecure-origin", "missing-supabase"])("fails closed when %s", async (mode) => {
    if (mode === "disabled") mocks.env.GOOGLE_LOGIN_ENABLED = false;
    if (mode === "demo") mocks.demo = true;
    if (mode === "synthetic") mocks.synthetic = true;
    if (mode === "missing-origin") mocks.env.NEXT_PUBLIC_APP_ORIGIN = "";
    if (mode === "invalid-origin") mocks.env.NEXT_PUBLIC_APP_ORIGIN = `${APP}/untrusted-path`;
    if (mode === "insecure-origin") mocks.env.NEXT_PUBLIC_APP_ORIGIN = "http://daycare.example.test";
    if (mode === "missing-supabase") mocks.env.NEXT_PUBLIC_SUPABASE_URL = "";
    const response = await POST(request());
    expectPrivate(response);
    expect(response.headers.get("location")).toBe(GOOGLE_LOGIN_FAILURE);
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it.each(["no-client", "provider-error", "exception", "missing-flow"])("safely reports %s without reflecting sensitive errors", async (failure) => {
    if (failure === "no-client") mocks.server.mockResolvedValue(null);
    if (failure === "provider-error") mocks.oauth.mockResolvedValue({ data: null, error: { message: "private-provider-token" } });
    if (failure === "exception") mocks.oauth.mockRejectedValue(new Error("private-provider-token"));
    if (failure === "missing-flow") mocks.oauth.mockResolvedValue({ data: { url: authorizationUrl() }, error: null });
    const response = await POST(request());
    expectPrivate(response);
    expect(response.headers.get("location")).toBe(GOOGLE_LOGIN_FAILURE);
    expect(await response.text()).not.toContain("private");
    expect(mocks.setCookie).not.toHaveBeenCalledWith(GOOGLE_FLOW_COOKIE, expect.any(String), expect.objectContaining({ maxAge: 600 }));
  });

  it.each([
    ["provider", "github"], ["redirect_to", "https://evil.example"], ["code_challenge_method", "plain"],
    ["code_challenge", "short"], ["prompt", "consent"], ["access_type", "offline"], ["state", "untrusted"],
  ])("rejects an unexpected SDK authorization URL field %s", async (key, value) => {
    const url = new URL(authorizationUrl()); url.searchParams.set(key, value);
    mocks.oauth.mockResolvedValue({ data: { url: url.toString(), flowId: FLOW }, error: null });
    expect((await POST(request())).headers.get("location")).toBe(GOOGLE_LOGIN_FAILURE);
  });

  it.each(["https://evil.example/auth/v1/authorize", "javascript:alert(1)", "//evil.example", "https://auth-project.supabase.co/other"])("never redirects to an untrusted SDK destination %s", async (url) => {
    mocks.oauth.mockResolvedValue({ data: { url, flowId: FLOW }, error: null });
    expect((await POST(request())).headers.get("location")).toBe(GOOGLE_LOGIN_FAILURE);
  });

  it("ignores body privilege fields and uses no body-supplied identity or destination", async () => {
    const response = await POST(new Request(`${APP}/auth/google`, { method: "POST", headers: { origin: APP }, body: "role=admin&audience=family&next=https://evil.example" }));
    expect(response.headers.get("location")).toBe(authorizationUrl());
    expect(JSON.stringify(mocks.oauth.mock.calls)).not.toContain("evil");
    expect(JSON.stringify(mocks.oauth.mock.calls)).not.toContain("admin");
  });
});
