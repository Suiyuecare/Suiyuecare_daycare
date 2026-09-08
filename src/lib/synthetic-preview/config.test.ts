import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { isSyntheticPreviewRequestBlocked, validateSyntheticPreviewEnvironment } from "./config";

const preview = {
  NODE_ENV: "production", SYNTHETIC_PREVIEW: "true",
  SYNTHETIC_PREVIEW_PURPOSE: "synthetic-read-only", NEXT_PUBLIC_SYNTHETIC_PREVIEW: "true",
};

describe("isolated synthetic preview configuration", () => {
  it("does not turn local demo or normal production into online preview", () => {
    expect(validateSyntheticPreviewEnvironment({ NODE_ENV: "production", DEMO_MODE: "true" })).toBe(false);
    expect(validateSyntheticPreviewEnvironment({ NODE_ENV: "development", DEMO_MODE: "true" })).toBe(false);
    expect(validateSyntheticPreviewEnvironment({})).toBe(false);
  });
  it("allows a purpose-bound local production build without requiring cloud resources", () => {
    expect(validateSyntheticPreviewEnvironment(preview)).toBe(true);
  });
  it.each([
    { SYNTHETIC_PREVIEW: "yes" },
    { SYNTHETIC_PREVIEW_PURPOSE: undefined },
    { SYNTHETIC_PREVIEW_PURPOSE: "production" },
    { NEXT_PUBLIC_SYNTHETIC_PREVIEW: "false" },
    { DEMO_MODE: "true" },
    { SYNTHETIC_PREVIEW: "false" },
  ])("rejects inconsistent or ambiguous purpose flags: %j", (change) => {
    expect(() => validateSyntheticPreviewEnvironment({ ...preview, ...change })).toThrow(/SYNTHETIC_PREVIEW_/u);
  });
  it("requires exact Vercel project binding and a preview deployment", () => {
    const cloud = { ...preview, VERCEL: "1", VERCEL_ENV: "preview",
      VERCEL_PROJECT_ID: "prj_synthetic123", SYNTHETIC_PREVIEW_PROJECT_ID: "prj_synthetic123" };
    expect(validateSyntheticPreviewEnvironment(cloud)).toBe(true);
    expect(() => validateSyntheticPreviewEnvironment({ ...cloud, VERCEL_ENV: "production" })).toThrow("SYNTHETIC_PREVIEW_DEPLOYMENT_TARGET_INVALID");
    expect(() => validateSyntheticPreviewEnvironment({ ...cloud, VERCEL_PROJECT_ID: "prj_other456" })).toThrow("SYNTHETIC_PREVIEW_PROJECT_BINDING_REQUIRED");
    expect(() => validateSyntheticPreviewEnvironment({ ...preview, VERCEL: "1", VERCEL_ENV: "preview" })).toThrow("SYNTHETIC_PREVIEW_PROJECT_BINDING_REQUIRED");
  });
  it.each(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_ACCESS_TOKEN",
    "DATABASE_URL", "PGPASSWORD", "AWS_ACCESS_KEY_ID", "AWS_SHARED_CREDENTIALS_FILE",
    "AWS_WEB_IDENTITY_TOKEN_FILE", "HTML_ARCHIVE_BUCKET", "AWS_KMS_KEY_ID",
    "LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN", "SMS_API_KEY",
    "TWILIO_AUTH_TOKEN", "DOCUMENT_DOWNLOAD_SIGNING_SECRET", "SMS_PROVIDER"])(
    "rejects external setting %s without printing its value", (key) => {
      const secret = "do-not-echo-this-synthetic-value";
      try { validateSyntheticPreviewEnvironment({ ...preview, [key]: secret }); throw new Error("expected rejection"); }
      catch (error) {
        expect((error as Error).message).toBe("SYNTHETIC_PREVIEW_EXTERNAL_CONFIGURATION_FORBIDDEN");
        expect((error as Error).message).not.toContain(secret);
      }
    });
  it("allows explicitly empty external settings and suppressed SMS", () => {
    expect(validateSyntheticPreviewEnvironment({ ...preview, NEXT_PUBLIC_SUPABASE_URL: "", SMS_PROVIDER: "mock" })).toBe(true);
  });
});

describe("synthetic preview request boundary", () => {
  it.each(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"])(
    "rejects every %s API call including disguised file paths", (method) => {
      for (const pathname of ["/api", "/api/imports/html", "/api/reports.svg", "/api%2fimports", "/%61pi/imports", "/API/imports"]) {
        expect(isSyntheticPreviewRequestBlocked(method, pathname)).toBe(true);
      }
    });
  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"])(
    "rejects %s on pages, assets and server actions", (method) => {
      for (const pathname of ["/app/dashboard", "/login", "/_next/static/main.js", "/icon.svg", "/sw.js"]) {
        expect(isSyntheticPreviewRequestBlocked(method, pathname)).toBe(true);
      }
    });
  it("allows only page and asset GET or HEAD", () => {
    for (const method of ["GET", "HEAD"]) for (const path of ["/login", "/app/dashboard", "/family/home", "/_next/static/main.js"]) {
      expect(isSyntheticPreviewRequestBlocked(method, path)).toBe(false);
    }
    expect(isSyntheticPreviewRequestBlocked("GET", "/invalid%path")).toBe(true);
  });
});
