import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_ORIGIN: "https://daycare.example.test",
    NEXT_PUBLIC_SUPABASE_URL: "https://auth-project.supabase.co",
    PORTAL_DAYCARE_HANDOFF_SECRET: "synthetic-dedicated-handoff-secret-at-least-32-bytes",
  },
  demo: false, synthetic: false, configured: true,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: mocks.env,
  isDemoMode: () => mocks.demo,
  isSyntheticPreviewMode: () => mocks.synthetic,
  hasSupabaseAdminConfiguration: () => mocks.configured,
}));

import {
  isPortalFormPost, portalHandoffConfiguration, portalTicketHash,
  readPortalHandoffForm, safePortalReturnTo, verifyPortalHandoff,
} from "./portal-handoff";

const claims = {
  email: "approved@suiyuecare.com", googleSub: "123456789012345678901",
  aud: "daycare", iat: 1780000000, exp: 1780000600,
  jti: "38f32f9f-7811-4b29-a881-780e6e03be0b",
  returnTo: "/app/dashboard?view=today",
};
const now = 1780000010;
function ticket(value: unknown, rawJson?: string) {
  const payload = Buffer.from(rawJson ?? JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", mocks.env.PORTAL_DAYCARE_HANDOFF_SECRET).update(payload).digest("base64url");
  return { payload, signature };
}
function request(body: string, overrides: { url?: string; origin?: string; contentType?: string; fetchSite?: string } = {}) {
  return new Request(overrides.url ?? "https://daycare.example.test/api/auth/handoff", {
    method: "POST",
    headers: {
      origin: overrides.origin ?? "https://login.suiyuecare.com",
      "content-type": overrides.contentType ?? "application/x-www-form-urlencoded",
      ...(overrides.fetchSite ? { "sec-fetch-site": overrides.fetchSite } : {}),
    },
    body,
  });
}

beforeEach(() => {
  mocks.demo = false; mocks.synthetic = false; mocks.configured = true;
  mocks.env.NODE_ENV = "production";
  mocks.env.NEXT_PUBLIC_APP_ORIGIN = "https://daycare.example.test";
  mocks.env.PORTAL_DAYCARE_HANDOFF_SECRET = "synthetic-dedicated-handoff-secret-at-least-32-bytes";
});

describe("Portal signed handoff contract", () => {
  it("accepts the exact fresh Portal assertion and only its local work route", () => {
    const { payload, signature } = ticket(claims);
    expect(verifyPortalHandoff(payload, signature, mocks.env.PORTAL_DAYCARE_HANDOFF_SECRET, now)).toEqual(claims);
    expect(safePortalReturnTo("/app/dashboard?view=today")).toBe(true);
    expect(portalTicketHash(claims.jti)).toMatch(/^[a-f0-9]{64}$/u);
    expect(portalTicketHash(claims.jti)).not.toContain(claims.jti);
  });

  it("rejects tampering, a different HMAC key, noncanonical base64 and noncanonical JSON", () => {
    const valid = ticket(claims);
    const wrongSignature = valid.signature.slice(0, -1)
      + (valid.signature.endsWith("A") ? "B" : "A");
    expect(verifyPortalHandoff(valid.payload, wrongSignature, mocks.env.PORTAL_DAYCARE_HANDOFF_SECRET, now)).toBeNull();
    expect(verifyPortalHandoff(valid.payload, valid.signature, "other-dedicated-key", now)).toBeNull();
    expect(verifyPortalHandoff(`${valid.payload}=`, valid.signature, mocks.env.PORTAL_DAYCARE_HANDOFF_SECRET, now)).toBeNull();
    const duplicate = ticket(claims, JSON.stringify(claims).replace('"aud":"daycare"', '"aud":"daycare","aud":"daycare"'));
    expect(verifyPortalHandoff(duplicate.payload, duplicate.signature, mocks.env.PORTAL_DAYCARE_HANDOFF_SECRET, now)).toBeNull();
    const spaced = ticket(claims, JSON.stringify(claims, null, 2));
    expect(verifyPortalHandoff(spaced.payload, spaced.signature, mocks.env.PORTAL_DAYCARE_HANDOFF_SECRET, now)).toBeNull();
  });

  it.each([
    { aud: "finance" }, { email: "Approved@suiyuecare.com" }, { email: "other example" },
    { googleSub: "" }, { googleSub: "invalid subject" },
    { jti: "not-a-v4-uuid" }, { iat: now + 31 },
    { exp: now }, { exp: claims.iat + 601 },
    { returnTo: "https://evil.example/app" }, { returnTo: "//evil.example" },
    { returnTo: "/app/../admin" }, { returnTo: "/app/%2e%2e/admin" },
    { returnTo: "/app\\evil.example" }, { returnTo: "/app#token" },
  ])("fails closed on altered audience, principal, time or destination: %j", (override) => {
    const { payload, signature } = ticket({ ...claims, ...override });
    expect(verifyPortalHandoff(payload, signature, mocks.env.PORTAL_DAYCARE_HANDOFF_SECRET, now)).toBeNull();
  });

  it("rejects unknown, missing and expired claims even if correctly HMAC-signed", () => {
    for (const altered of [
      { ...claims, role: "admin" },
      Object.fromEntries(Object.entries(claims).filter(([key]) => key !== "googleSub")),
      { ...claims, iat: now - 601, exp: now - 1 },
    ]) {
      const { payload, signature } = ticket(altered);
      expect(verifyPortalHandoff(payload, signature, mocks.env.PORTAL_DAYCARE_HANDOFF_SECRET, now)).toBeNull();
    }
  });
});

describe("Portal form and configuration boundary", () => {
  it("admits only the configured Daycare origin and fixed Portal origin", () => {
    const valid = request("payload=x&signature=y", { fetchSite: "same-site" });
    expect(portalHandoffConfiguration(valid)).toEqual(expect.objectContaining({ appOrigin: "https://daycare.example.test" }));
    expect(isPortalFormPost(valid)).toBe(true);
    expect(isPortalFormPost(request("payload=x&signature=y", {
      origin: "https://suiyuecare-website.vercel.app", fetchSite: "cross-site",
    }))).toBe(true);
    expect(isPortalFormPost(request("payload=x&signature=y", {
      origin: "https://suiyuecare-website.vercel.app",
    }))).toBe(true); // Safari may omit Fetch Metadata.
    expect(portalHandoffConfiguration(request("", { url: "https://evil.example/api/auth/handoff" }))).toBeNull();
    expect(isPortalFormPost(request("", { origin: "https://evil.example" }))).toBe(false);
    expect(isPortalFormPost(request("", { origin: "null" }))).toBe(false);
    expect(isPortalFormPost(request("", { fetchSite: "cross-site" }))).toBe(false);
    expect(isPortalFormPost(request("", {
      origin: "https://suiyuecare-website.vercel.app", fetchSite: "same-site",
    }))).toBe(false);
    expect(isPortalFormPost(request("", { contentType: "application/json" }))).toBe(false);
    expect(isPortalFormPost(request("", { url: "https://daycare.example.test/api/auth/handoff?next=//evil.example" }))).toBe(false);
  });

  it("requires a dedicated secret, admin configuration, and no demo", () => {
    const valid = request("");
    mocks.env.PORTAL_DAYCARE_HANDOFF_SECRET = "short";
    expect(portalHandoffConfiguration(valid)).toBeNull();
    mocks.env.PORTAL_DAYCARE_HANDOFF_SECRET = "synthetic-dedicated-handoff-secret-at-least-32-bytes";
    mocks.configured = false;
    expect(portalHandoffConfiguration(valid)).toBeNull();
    mocks.configured = true;
    mocks.demo = true;
    expect(portalHandoffConfiguration(valid)).toBeNull();
  });

  it("accepts exactly one of each form field under 4 KiB", async () => {
    expect(await readPortalHandoffForm(request("payload=one&signature=two"))).toEqual({ payload: "one", signature: "two" });
    expect(await readPortalHandoffForm(request("payload=one&payload=two&signature=three"))).toBeNull();
    expect(await readPortalHandoffForm(request("payload=one&signature=two&role=admin"))).toBeNull();
    expect(await readPortalHandoffForm(request(`payload=${"a".repeat(4096)}&signature=x`))).toBeNull();
  });
});
