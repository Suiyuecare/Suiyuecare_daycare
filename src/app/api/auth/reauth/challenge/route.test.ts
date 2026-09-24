import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  demo: vi.fn(), server: vi.fn(), admin: vi.fn(), getUser: vi.fn(),
  getClaims: vi.fn(), eligible: vi.fn(), issue: vi.fn(), tenant: vi.fn(), from: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo }));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.tenant }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.server }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));

import { POST } from "./route";
import { parseReauthChallengeEnvelope } from "@/lib/auth/reauth-client";

const USER = "58000000-0000-4000-8000-000000000101";
const OTHER_USER = "58000000-0000-4000-8000-000000000102";
const SESSION = "58000000-0000-4000-8000-000000000103";
const issuedAt = Math.floor(Date.now() / 1000) - 60;
const validClaims = {
  sub: USER, role: "authenticated", aal: "aal1", session_id: SESSION,
  iat: issuedAt, exp: issuedAt + 3600, jti: "synthetic-before-mfa",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.demo.mockReturnValue(false);
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER, is_anonymous: false } }, error: null });
  mocks.getClaims.mockResolvedValue({ data: { claims: { ...validClaims } }, error: null });
  mocks.eligible.mockResolvedValue({ data: true, error: null });
  mocks.issue.mockImplementation(async (_name: string, args: { p_challenge_id: string }) => ({
    data: [{ challenge_id: args.p_challenge_id, expires_at: new Date(Date.now() + 300_000).toISOString() }], error: null,
  }));
  mocks.server.mockResolvedValue({ auth: { getUser: mocks.getUser, getClaims: mocks.getClaims }, rpc: mocks.eligible, from: mocks.from });
  mocks.admin.mockReturnValue({ rpc: mocks.issue });
  // AAL1 staff must not obtain tenant context: the regression must pass even
  // when that protected view is unavailable, without querying any business row.
  mocks.tenant.mockResolvedValue(null);
});

describe("self-only pre-MFA challenge issuance", () => {
  it.each(["aal1", "aal2"])("lets an eligible %s employee begin MFA without tenant data", async (aal) => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { ...validClaims, aal } }, error: null });
    const response = await POST();
    const body = parseReauthChallengeEnvelope(await response.json(), response.status);
    expect(body.data.demo).toBe(false);
    expect(mocks.eligible).toHaveBeenCalledExactlyOnceWith("can_begin_staff_mfa");
    expect(mocks.issue).toHaveBeenCalledWith("issue_aal2_reauth_challenge", expect.objectContaining({
      p_user_id: USER, p_session_id: SESSION, p_issued_jwt_iat: new Date(issuedAt * 1000).toISOString(),
      p_nonce_sha256: createHash("sha256").update(body.data.nonce).digest("hex"), p_ttl_seconds: 300,
    }));
    expect(mocks.getUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.getClaims.mock.invocationCallOrder[0]!);
    expect(mocks.eligible.mock.invocationCallOrder[0]).toBeLessThan(mocks.issue.mock.invocationCallOrder[0]!);
    expect(mocks.tenant).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(JSON.stringify(body)).not.toContain(USER);
    expect(JSON.stringify(body)).not.toContain(SESSION);
  });

  it.each(["server", "admin"] as const)("fails closed without the %s configuration", async (key) => {
    mocks[key].mockReturnValue(null);
    const response = await POST();
    expect(response.status).toBe(503);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: USER } }, error: { message: "sensitive-auth-error" } },
    { data: { user: { id: USER, is_anonymous: true } }, error: null },
    { data: { user: { id: "invalid" } }, error: null },
  ])("rejects an absent, invalid, or anonymous Auth identity", async (result) => {
    mocks.getUser.mockResolvedValue(result);
    const response = await POST();
    expect(response.status).toBe(401);
    expect(mocks.getClaims).not.toHaveBeenCalled();
    expect(mocks.eligible).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("sensitive-auth-error");
  });

  it.each([
    { sub: OTHER_USER }, { role: "service_role" }, { aal: "invalid" },
    { is_anonymous: true }, { session_id: null }, { session_id: "not-a-session" },
    { iat: "123" }, { iat: Number.NaN }, { iat: Infinity }, { iat: 1.5 },
    { iat: 0 }, { iat: Number.MAX_SAFE_INTEGER },
  ])("rejects mismatched or malformed verified claims: %j", async (override) => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { ...validClaims, ...override } }, error: null });
    const response = await POST();
    expect(response.status).toBe(401);
    expect(mocks.eligible).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("rejects a claim verification error without exposing service details", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: validClaims }, error: { message: "sensitive-token-detail" } });
    const response = await POST();
    expect(response.status).toBe(401);
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("sensitive-token-detail");
  });

  it.each([false, null, undefined, "true", 1, { eligible: true }])("does not issue unless the self-only check returns literal true (%j)", async (data) => {
    mocks.eligible.mockResolvedValue({ data, error: null });
    const response = await POST();
    expect(response.status).toBe(403);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("fails closed when the migration is absent or the eligibility RPC fails", async () => {
    mocks.eligible.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "private-schema-detail" } });
    const response = await POST();
    expect(response.status).toBe(503);
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("private-schema-detail");
  });

  it("returns only a structured error if challenge issuance fails", async () => {
    mocks.issue.mockResolvedValue({ data: null, error: { message: "sensitive-database-detail" } });
    const response = await POST();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("sensitive-database-detail");
  });

  it("does not use user-editable metadata for identity or qualification", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER, user_metadata: { id: OTHER_USER, role: "tenant_admin" } } }, error: null });
    mocks.eligible.mockResolvedValue({ data: false, error: null });
    expect((await POST()).status).toBe(403);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it.each(["getUser", "getClaims", "eligible", "issue"] as const)("returns a private structured response if %s throws", async (key) => {
    mocks[key].mockRejectedValue(new Error("sensitive-provider-detail"));
    const response = await POST();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(await response.text()).not.toContain("sensitive-provider-detail");
    if (key !== "issue") expect(mocks.issue).not.toHaveBeenCalled();
  });
});
