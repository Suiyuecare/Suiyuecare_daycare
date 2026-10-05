import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_ORIGIN: "https://daycare.example.test",
    NEXT_PUBLIC_SUPABASE_URL: "https://auth-project.supabase.co",
    PORTAL_DAYCARE_HANDOFF_SECRET: "synthetic-dedicated-handoff-secret-at-least-32-bytes",
  },
  admin: vi.fn(), adminRpc: vi.fn(), getUserById: vi.fn(), generateLink: vi.fn(),
  server: vi.fn(), verifyOtp: vi.fn(), getUser: vi.fn(), getClaims: vi.fn(),
  staffRpc: vi.fn(), signOut: vi.fn(), setCookie: vi.fn(),
  cookieValues: new Map<string, string>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: mocks.env,
  hasSupabaseAdminConfiguration: () => true,
  isDemoMode: () => false,
  isSyntheticPreviewMode: () => false,
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.server }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  getAll: () => Array.from(mocks.cookieValues, ([name, value]) => ({ name, value })),
  set: mocks.setCookie,
}) }));

import { POST } from "./route";
import { PORTAL_FIRST_ACTIVATION, PORTAL_HANDOFF_FAILURE } from "@/lib/auth/portal-handoff";

const USER = "58000000-0000-4000-8000-000000000301";
const SESSION = "61000000-0000-4000-8000-000000000302";
const JTI = "38f32f9f-7811-4b29-a881-780e6e03be0b";
const EMAIL = "approved@suiyuecare.com";
const GOOGLE_SUB = "123456789012345678901";
const APP = "https://daycare.example.test";
function ticket(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    email: EMAIL, googleSub: GOOGLE_SUB, aud: "daycare",
    iat: now, exp: now + 600, jti: JTI, returnTo: "/app/dashboard?from=portal", ...overrides,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", mocks.env.PORTAL_DAYCARE_HANDOFF_SECRET).update(payload).digest("base64url");
  return { claims, payload, signature };
}
function request(options: { url?: string; origin?: string; fetchSite?: string; payload?: string; signature?: string } = {}) {
  const signed = ticket();
  return new Request(options.url ?? `${APP}/api/auth/handoff`, {
    method: "POST",
    headers: {
      origin: options.origin ?? "https://login.suiyuecare.com",
      "content-type": "application/x-www-form-urlencoded",
      ...(options.fetchSite ? { "sec-fetch-site": options.fetchSite } : {}),
    },
    body: new URLSearchParams({ payload: options.payload ?? signed.payload, signature: options.signature ?? signed.signature }),
  });
}
async function expectDenied(response: Response) {
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(PORTAL_HANDOFF_FAILURE);
  expect(response.headers.get("cache-control")).toContain("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(await response.text()).toBe("");
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookieValues.clear();
  mocks.setCookie.mockImplementation((name: string, value: string) => mocks.cookieValues.set(name, value));
  mocks.adminRpc.mockImplementation(async (name: string) => ({
    data: name === "claim_portal_sso_ticket" ? USER : name === "bind_portal_sso_session" ? true : null,
    error: null,
  }));
  mocks.getUserById.mockResolvedValue({ data: { user: {
    id: USER, email: EMAIL, email_confirmed_at: "2026-01-01T00:00:00Z", is_anonymous: false,
  } }, error: null });
  mocks.generateLink.mockResolvedValue({ data: {
    user: { id: USER }, properties: { hashed_token: "syntheticHashedTokenValue123456789012345678901234567890" },
  }, error: null });
  mocks.admin.mockReturnValue({ rpc: mocks.adminRpc, auth: { admin: {
    getUserById: mocks.getUserById, generateLink: mocks.generateLink,
  } } });
  mocks.verifyOtp.mockResolvedValue({ data: { session: { access_token: "never-return-this" }, user: { id: USER } }, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER, email: EMAIL, is_anonymous: false } }, error: null });
  mocks.getClaims.mockResolvedValue({ data: { claims: {
    sub: USER, iss: "https://auth-project.supabase.co/auth/v1", role: "authenticated",
    aal: "aal1", is_anonymous: false, session_id: SESSION,
    amr: [{ method: "otp", timestamp: 1780000000 }],
  } }, error: null });
  mocks.staffRpc.mockResolvedValue({ data: true, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.server.mockResolvedValue({ auth: {
    verifyOtp: mocks.verifyOtp, getUser: mocks.getUser,
    getClaims: mocks.getClaims, signOut: mocks.signOut,
  }, rpc: mocks.staffRpc });
});

describe("Daycare Portal SSO exchange", () => {
  it("consumes a signed ticket, mints its own AAL1 session, binds that session, and redirects locally", async () => {
    const response = await POST(request());
    expect(response.status).toBe(303);
    expect(mocks.adminRpc).toHaveBeenCalled();
    expect(mocks.adminRpc.mock.calls[0]?.[0]).toBe("claim_portal_sso_ticket");
    expect(await mocks.adminRpc.mock.results[0]?.value).toEqual({ data: USER, error: null });
    expect(mocks.admin.mock.results[0]?.value).toEqual(expect.objectContaining({
      auth: expect.objectContaining({ admin: expect.objectContaining({ getUserById: mocks.getUserById }) }),
    }));
    expect(mocks.getUserById).toHaveBeenCalled();
    expect(mocks.generateLink).toHaveBeenCalled();
    expect(mocks.verifyOtp).toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("/app/dashboard?from=portal");
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(mocks.adminRpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_portal_sso_ticket", "bind_portal_sso_session",
    ]);
    expect(mocks.adminRpc.mock.calls[0]![1]).toEqual(expect.objectContaining({
      p_google_sub: GOOGLE_SUB, p_email: EMAIL,
      p_jti_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
    expect(mocks.adminRpc.mock.calls[1]![1]).toEqual(expect.objectContaining({ p_session_id: SESSION }));
    expect(mocks.generateLink).toHaveBeenCalledExactlyOnceWith({ type: "magiclink", email: EMAIL });
    expect(mocks.verifyOtp).toHaveBeenCalledExactlyOnceWith({
      token_hash: "syntheticHashedTokenValue123456789012345678901234567890", type: "magiclink",
    });
    expect(mocks.getClaims.mock.calls).toEqual([["never-return-this"], []]);
    expect(mocks.staffRpc).toHaveBeenCalledExactlyOnceWith("is_staff_login_allowed");
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(response.headers.get("location")).not.toContain(JTI);
    expect(response.headers.get("location")).not.toContain("never-return-this");
  });

  it("lets a valid B handoff replace an existing A cookie only after the new session is bound", async () => {
    mocks.cookieValues.set("sb-auth-project-auth-token", "existing-A-cookie");
    mocks.verifyOtp.mockImplementation(async () => {
      mocks.cookieValues.set("sb-auth-project-auth-token", "new-B-cookie");
      return { data: { session: { access_token: "new-B-access-token" }, user: { id: USER } }, error: null };
    });
    const response = await POST(request());
    expect(response.headers.get("location")).toBe("/app/dashboard?from=portal");
    expect(mocks.cookieValues.get("sb-auth-project-auth-token")).toBe("new-B-cookie");
    expect(mocks.adminRpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_portal_sso_ticket", "bind_portal_sso_session",
    ]);
  });

  it("accepts only the exact company OAuth bridge origin with cross-site metadata", async () => {
    const response = await POST(request({
      origin: "https://suiyuecare-website.vercel.app", fetchSite: "cross-site",
    }));
    expect(response.headers.get("location")).toBe("/app/dashboard?from=portal");
    expect(mocks.adminRpc).toHaveBeenCalled();
  });

  it("rejects a wrong signature, origin or host before any database or Auth call", async () => {
    const signed = ticket();
    const wrongSignature = signed.signature.slice(0, -1)
      + (signed.signature.endsWith("A") ? "B" : "A");
    await expectDenied(await POST(request({ signature: wrongSignature })));
    await expectDenied(await POST(request({ origin: "https://evil.example" })));
    await expectDenied(await POST(request({ url: "https://evil.example/api/auth/handoff" })));
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it("rejects a replayed or unapproved subject with no new Daycare session", async () => {
    mocks.cookieValues.set("sb-auth-project-auth-token", "already-admitted-account-A-cookie");
    mocks.adminRpc.mockResolvedValue({ data: null, error: null });
    await expectDenied(await POST(request()));
    expect(mocks.getUserById).not.toHaveBeenCalled();
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.server).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.cookieValues.get("sb-auth-project-auth-token")).toBe("already-admitted-account-A-cookie");
  });

  it("guides a valid pending first-use approval to one-time Google activation without admitting it", async () => {
    mocks.adminRpc.mockImplementation(async (name: string) => ({
      data: name === "claim_portal_sso_ticket" ? null
        : name === "is_portal_sso_first_activation_pending" ? true : false,
      error: null,
    }));
    const response = await POST(request());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(PORTAL_FIRST_ACTIVATION);
    expect(mocks.adminRpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_portal_sso_ticket", "is_portal_sso_first_activation_pending",
    ]);
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it("never generates a link when an approved Auth ID has changed or lost verified email", async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: {
      id: USER, email: EMAIL, email_confirmed_at: null,
    } }, error: null });
    await expectDenied(await POST(request()));
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("rejects magiclink account mismatch without exchanging the token", async () => {
    mocks.generateLink.mockResolvedValue({ data: {
      user: { id: "other-user" }, properties: { hashed_token: "syntheticHashedTokenValue123456789012345678901234567890" },
    }, error: null });
    await expectDenied(await POST(request()));
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("clears only Daycare Auth cookies when OTP exchange or session binding fails", async () => {
    mocks.cookieValues.set("sb-auth-project-auth-token", "sensitive-session-cookie");
    mocks.cookieValues.set("sb-auth-project-auth-token.0", "sensitive-session-chunk");
    mocks.cookieValues.set("sb-other-auth-token", "keep-this");
    mocks.cookieValues.set("daycare_branch", "keep-this-too");
    mocks.adminRpc.mockImplementation(async (name: string) => ({
      data: name === "claim_portal_sso_ticket" ? USER : false, error: null,
    }));
    await expectDenied(await POST(request()));
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(mocks.cookieValues.get("sb-auth-project-auth-token")).toBe("");
    expect(mocks.cookieValues.get("sb-auth-project-auth-token.0")).toBe("");
    expect(mocks.cookieValues.get("sb-other-auth-token")).toBe("keep-this");
    expect(mocks.cookieValues.get("daycare_branch")).toBe("keep-this-too");
  });

  it("rejects a stale same-user A cookie rather than binding A to newly issued B's ticket", async () => {
    const base = (await mocks.getClaims()).data.claims;
    mocks.getClaims.mockResolvedValueOnce({ data: { claims: base }, error: null })
      .mockResolvedValueOnce({ data: { claims: {
        ...base, session_id: "62000000-0000-4000-8000-000000000303",
      } }, error: null });
    await expectDenied(await POST(request()));
    expect(mocks.getClaims.mock.calls.slice(-2)).toEqual([["never-return-this"], []]);
    expect(mocks.adminRpc.mock.calls.map(([name]) => name)).toEqual(["claim_portal_sso_ticket"]);
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });

  it.each([
    { iss: "https://other-project.supabase.co/auth/v1" },
    { sub: "other-user" },
    { aal: "aal2" },
    { amr: [{ method: "password" }] },
  ])("rejects an unrelated, elevated or incorrect Auth JWT before binding: %j", async (override) => {
    const base = (await mocks.getClaims()).data.claims;
    mocks.getClaims.mockResolvedValue({ data: { claims: { ...base, ...override } }, error: null });
    await expectDenied(await POST(request()));
    expect(mocks.adminRpc.mock.calls.map(([name]) => name)).toEqual(["claim_portal_sso_ticket"]);
  });

  it("does not log signed payloads, Google subject, OTPs or provider failures", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.generateLink.mockRejectedValue(new Error("private-token-and-subject"));
    await expectDenied(await POST(request()));
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
    log.mockRestore(); error.mockRestore(); warn.mockRestore();
  });
});
