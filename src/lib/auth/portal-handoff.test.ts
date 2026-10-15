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
  resolvePortalHandoffConfiguration, portalFormPostFailure,
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
  it("classifies rejected form requests without returning raw header or URL values", () => {
    const missingOrigin = request(""); missingOrigin.headers.delete("origin");
    const emptyOrigin = request(""); emptyOrigin.headers.set("origin", "");
    const oversized = request(""); oversized.headers.set("content-length", "4097");
    const invalidLength = request(""); invalidLength.headers.set("content-length", "private-invalid-length");
    const missingContentType = request(""); missingContentType.headers.delete("content-type");
    const cases = [
      [new Request(request("").url, { method: "GET", headers: request("").headers }), "method"],
      [request("", { url: "https://daycare.example.test/private-path" }), "path"],
      [request("", { url: "https://daycare.example.test/api/auth/handoff?private=private-query-value" }), "path"],
      [request("", { url: "https://daycare.example.test/api/auth/handoff#private-fragment" }), "path"],
      [missingOrigin, "origin_missing"], [emptyOrigin, "origin_missing"],
      [request("", { origin: "null" }), "origin_null"],
      [request("", { origin: "https://private-origin.example.test" }), "origin_not_allowed"],
      [request("", { fetchSite: "cross-site" }), "fetch_site_mismatch"],
      [request("", { origin: "https://suiyuecare-website.vercel.app", fetchSite: "same-site" }), "fetch_site_mismatch"],
      [request("", { contentType: "application/private-content-type" }), "content_type"],
      [missingContentType, "content_type"], [oversized, "length"], [invalidLength, "length"],
    ] as const;
    for (const [input, reason] of cases) {
      const failure = portalFormPostFailure(input);
      expect(failure).toBe(reason);
      expect(isPortalFormPost(input)).toBe(false);
      expect(JSON.stringify(failure)).not.toMatch(/private-|https?:|4097/u);
    }
  });

  it("preserves the original form gate for every origin, metadata, content type and length combination", () => {
    for (const origin of [null, "", "null", "https://login.suiyuecare.com", "https://suiyuecare-website.vercel.app", "https://untrusted.example.test"]) {
      for (const fetchSite of [null, "", "same-site", "cross-site", "same-origin", "none"]) {
        for (const contentType of [null, "application/x-www-form-urlencoded", "Application/X-WWW-Form-Urlencoded; charset=UTF-8", "application/json", "application/x-www-form-urlencoded-extra"]) {
          for (const contentLength of [null, "", "0", "4096", "4097", "-1", "NaN", "Infinity"]) {
            const input = request("");
            for (const [name, value] of [["origin", origin], ["sec-fetch-site", fetchSite], ["content-type", contentType], ["content-length", contentLength]] as const) {
              if (value === null) input.headers.delete(name); else input.headers.set(name, value);
            }
            const normalizedType = input.headers.get("content-type")?.toLowerCase() ?? "";
            const normalizedLength = Number(input.headers.get("content-length") ?? "0");
            const allowedOrigin = (origin === "https://login.suiyuecare.com" && (!fetchSite || fetchSite === "same-site"))
              || (origin === "https://suiyuecare-website.vercel.app" && (!fetchSite || fetchSite === "cross-site"));
            const previouslyAllowed = allowedOrigin
              && /^application\/x-www-form-urlencoded(?:\s*;|$)/u.test(normalizedType)
              && Number.isFinite(normalizedLength) && normalizedLength <= 4096;
            expect(isPortalFormPost(input)).toBe(previouslyAllowed);
            expect(portalFormPostFailure(input) === null).toBe(previouslyAllowed);
          }
        }
      }
    }
  });

  it("classifies configuration failures without returning any credential in the failure result", () => {
    mocks.env.PORTAL_DAYCARE_HANDOFF_SECRET = "short";
    expect(resolvePortalHandoffConfiguration(request(""))).toEqual({ configuration: null, failure: "signing_key_unconfigured" });
    mocks.configured = false;
    expect(resolvePortalHandoffConfiguration(request(""))).toEqual({ configuration: null, failure: "admin_unconfigured" });
    mocks.demo = true;
    expect(resolvePortalHandoffConfiguration(request(""))).toEqual({ configuration: null, failure: "disabled_mode" });
    mocks.demo = false; mocks.configured = true;
    mocks.env.PORTAL_DAYCARE_HANDOFF_SECRET = "synthetic-dedicated-handoff-secret-at-least-32-bytes";
    mocks.env.NEXT_PUBLIC_APP_ORIGIN = "https://daycare.example.test/unexpected";
    expect(resolvePortalHandoffConfiguration(request(""))).toEqual({ configuration: null, failure: "origin_configuration_invalid" });
    mocks.env.NEXT_PUBLIC_APP_ORIGIN = "https://daycare.example.test";
    expect(resolvePortalHandoffConfiguration(request("", { url: "https://another.example.test/api/auth/handoff" }))).toEqual({ configuration: null, failure: "request_origin_mismatch" });
  });
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
