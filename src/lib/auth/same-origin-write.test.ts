import { beforeEach, describe, expect, it, vi } from "vitest";

const configuration = vi.hoisted(() => ({
  NEXT_PUBLIC_APP_ORIGIN: "https://daycare.example.test" as string | undefined,
  NODE_ENV: "production",
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: configuration }));

import { IntegrationError } from "@/lib/integrations/errors";
import { requireSameOriginJsonWrite, requireSameOriginWrite } from "./same-origin-write";

const trusted = "https://daycare.example.test";
function request(overrides: { url?: string; method?: string; headers?: Record<string, string | null> } = {}) {
  const headers = new Headers({ origin: trusted, "content-type": "application/json" });
  for (const [key, value] of Object.entries(overrides.headers ?? {})) {
    if (value === null) headers.delete(key);
    else headers.set(key, value);
  }
  return new Request(overrides.url ?? `${trusted}/api/rule-review?synthetic=1`, {
    method: overrides.method ?? "POST", headers,
  });
}
function rejects(input: Request, status: number, code: string) {
  let caught: unknown;
  try { requireSameOriginJsonWrite(input); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(IntegrationError);
  expect(caught).toMatchObject({ httpStatus: status, code });
  return caught as IntegrationError;
}

beforeEach(() => {
  configuration.NEXT_PUBLIC_APP_ORIGIN = trusted;
  configuration.NODE_ENV = "production";
});

describe("explicit private attachment origin/MIME additions preserve existing JSON POST policy", () => {
  it("admits explicit multipart POST and JSON PATCH without consuming the body", () => {
    const multipart = request({ headers: { "content-type": "multipart/form-data; boundary=synthetic-boundary" } });
    const patch = request({ method: "PATCH" });
    expect(requireSameOriginWrite(multipart, { method: "POST", format: "multipart" })).toBeUndefined();
    expect(requireSameOriginWrite(patch, { method: "PATCH", format: "json" })).toBeUndefined();
    expect(multipart.bodyUsed).toBe(false); expect(patch.bodyUsed).toBe(false);
    rejects(multipart, 415, "JSON_CONTENT_TYPE_REQUIRED"); rejects(patch, 403, "ORIGIN_NOT_ALLOWED");
  });
  it.each(["multipart/form-data", "multipart/form-data; boundary=", "multipart/form-data; boundary=test; extra=value",
    "multipart/form-data; boundary=\"unterminated", `multipart/form-data; boundary=${"x".repeat(71)}`, "application/json"])("rejects malformed multipart boundary %s", contentType => {
    const input = request({ headers: { "content-type": contentType } });
    expect(() => requireSameOriginWrite(input, { method: "POST", format: "multipart" })).toThrowError(expect.objectContaining({ httpStatus: 415, code: "MULTIPART_CONTENT_TYPE_REQUIRED" }));
    expect(input.bodyUsed).toBe(false);
  });
  it.each([null, "null", "https://finance.example.test"])("rejects Origin %s for both newly allowed formats without consuming bytes", origin => {
    for (const options of [{ method: "POST", format: "multipart" }, { method: "PATCH", format: "json" }] as const) {
      const input = request({ method: options.method, headers: { origin, "content-type": options.format === "json" ? "application/json" : "multipart/form-data; boundary=synthetic" } });
      expect(() => requireSameOriginWrite(input, options)).toThrowError(expect.objectContaining({ httpStatus: 403, code: "ORIGIN_NOT_ALLOWED" }));
      expect(input.bodyUsed).toBe(false);
    }
  });
});

describe("configured-origin JSON write defense (no external network)", () => {
  it("accepts a same-origin JSON POST, without consuming the body", () => {
    const input = request({ headers: { "sec-fetch-site": "same-origin" } });
    const json = vi.spyOn(input, "json");
    const text = vi.spyOn(input, "text");
    expect(requireSameOriginJsonWrite(input)).toBeUndefined();
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(input.bodyUsed).toBe(false);
  });

  it("allows absent Sec-Fetch-Site only when both origins match", () => {
    expect(requireSameOriginJsonWrite(request())).toBeUndefined();
    rejects(request({ headers: { origin: "https://finance.example.test" } }), 403, "ORIGIN_NOT_ALLOWED");
  });

  it.each([null, "null", "https://finance.example.test", `${trusted}/`,
    "https://daycare.example.test.evil.test", `${trusted}@evil.test`,
    "https://daycare.example.test:8443", "https://DAYCARE.example.test",
    "https://daycare.example.test:443", `${trusted}, https://evil.test`])(
    "rejects untrusted or noncanonical Origin %s", (origin) => {
      rejects(request({ headers: { origin } }), 403, "ORIGIN_NOT_ALLOWED");
    },
  );

  it.each(["same-site", "cross-site", "none", "", "SAME-ORIGIN"])(
    "rejects Sec-Fetch-Site %s", (fetchSite) => {
      rejects(request({ headers: { "sec-fetch-site": fetchSite } }), 403, "ORIGIN_NOT_ALLOWED");
    },
  );

  it.each(["GET", "PUT", "PATCH", "DELETE", "OPTIONS"])("rejects method %s", (method) => {
    rejects(request({ method }), 403, "ORIGIN_NOT_ALLOWED");
  });

  it("does not trust Host or forwarded headers in either direction", () => {
    const headers = { host: "evil.test", "x-forwarded-host": "evil.test", "x-forwarded-proto": "http" };
    expect(requireSameOriginJsonWrite(request({ headers }))).toBeUndefined();
    rejects(request({ url: "https://evil.test/api/review", headers: {
      host: "daycare.example.test", "x-forwarded-host": "daycare.example.test", "x-forwarded-proto": "https",
    } }), 403, "ORIGIN_NOT_ALLOWED");
  });

  it.each([undefined, "", "not-a-url", `${trusted}/settings`, `${trusted}/%2f`,
    `${trusted}?token=secret`, `${trusted}#token=secret`,
    "https://secret:token@daycare.example.test", "ftp://daycare.example.test", "http://daycare.example.test"])(
    "rejects invalid configured origin %s", (origin) => {
      configuration.NEXT_PUBLIC_APP_ORIGIN = origin;
      rejects(request(), 503, "SERVICE_NOT_CONFIGURED");
    },
  );

  it("normalizes a root-slash configuration consistently with Google sign-in", () => {
    configuration.NEXT_PUBLIC_APP_ORIGIN = `${trusted}/`;
    expect(requireSameOriginJsonWrite(request())).toBeUndefined();
    rejects(request({ headers: { origin: `${trusted}/` } }), 403, "ORIGIN_NOT_ALLOWED");
  });

  it("normalizes configured origin case and a default port, not the Origin header", () => {
    configuration.NEXT_PUBLIC_APP_ORIGIN = "https://DAYCARE.example.test:443/";
    expect(requireSameOriginJsonWrite(request({ url: `${trusted}:443/api/review` }))).toBeUndefined();
  });

  it("requires exact nondefault ports", () => {
    configuration.NEXT_PUBLIC_APP_ORIGIN = `${trusted}:8443/`;
    expect(requireSameOriginJsonWrite(request({ url: `${trusted}:8443/api/review`, headers: { origin: `${trusted}:8443` } }))).toBeUndefined();
    rejects(request({ headers: { origin: `${trusted}:8443` } }), 403, "ORIGIN_NOT_ALLOWED");
    rejects(request({ url: `${trusted}:8443/api/review` }), 403, "ORIGIN_NOT_ALLOWED");
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])("allows local HTTP %s in nonproduction only", (host) => {
    const origin = `http://${host}:3000`;
    configuration.NODE_ENV = "development";
    configuration.NEXT_PUBLIC_APP_ORIGIN = `${origin}/`;
    expect(requireSameOriginJsonWrite(request({ url: `${origin}/api/review`, headers: { origin } }))).toBeUndefined();
    configuration.NODE_ENV = "production";
    rejects(request({ url: `${origin}/api/review`, headers: { origin } }), 503, "SERVICE_NOT_CONFIGURED");
  });

  it.each(["http://localhost.evil.test:3000", "http://127.0.0.2:3000", "http://192.168.1.3", "http://daycare.example.test"])(
    "does not broaden development HTTP to %s", (origin) => {
      configuration.NODE_ENV = "test";
      configuration.NEXT_PUBLIC_APP_ORIGIN = origin;
      rejects(request(), 503, "SERVICE_NOT_CONFIGURED");
    },
  );

  it.each(["application/json", "Application/JSON", "application/json; charset=utf-8",
    "application/json ; Charset = \"UTF-8\"", "application/json; charset=utf-8; profile=synthetic", "application/json; profile=\"synthetic;quoted\""])(
    "accepts JSON MIME with valid parameters %s", (contentType) => {
      expect(requireSameOriginJsonWrite(request({ headers: { "CoNtEnT-TyPe": contentType, OrIgIn: trusted } }))).toBeUndefined();
    },
  );

  it.each([null, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=test",
    "application/problem+json", "application/jsonp", "application/json, text/plain", "application/json;",
    "application/json; charset", "application/json; charset=", "application/json; charset=\"unterminated",
    "application/json; charset=utf-8 extra", "application/json; @charset=utf-8"])(
    "rejects non-JSON or malformed MIME %s", (contentType) => {
      rejects(request({ headers: { "content-type": contentType } }), 415, "JSON_CONTENT_TYPE_REQUIRED");
    },
  );

  it("never reflects origin, config, headers or sensitive values in errors", () => {
    const secret = "synthetic-authorization-token-do-not-reflect";
    const denied = rejects(request({ headers: { origin: `https://${secret}.evil.test`, authorization: `Bearer ${secret}` } }), 403, "ORIGIN_NOT_ALLOWED");
    configuration.NEXT_PUBLIC_APP_ORIGIN = `https://${secret}:password@daycare.example.test`;
    const unavailable = rejects(request(), 503, "SERVICE_NOT_CONFIGURED");
    configuration.NEXT_PUBLIC_APP_ORIGIN = trusted;
    const wrongType = rejects(request({ headers: { "content-type": `text/${secret}` } }), 415, "JSON_CONTENT_TYPE_REQUIRED");
    for (const error of [denied, unavailable, wrongType]) {
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(error.message).not.toContain(secret);
      expect(error.field).toBeUndefined();
    }
  });
});
