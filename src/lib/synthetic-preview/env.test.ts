import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
beforeEach(() => {
  vi.resetModules();
  for (const key of ["SYNTHETIC_PREVIEW", "SYNTHETIC_PREVIEW_PURPOSE", "SYNTHETIC_PREVIEW_PROJECT_ID",
    "NEXT_PUBLIC_SYNTHETIC_PREVIEW", "VERCEL", "VERCEL_ENV", "VERCEL_PROJECT_ID"]) vi.stubEnv(key, "");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("real server environment mode separation", () => {
  it("preserves the production demo guard", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "true");
    const mode = await import("@/lib/env");
    expect(mode.isDemoMode()).toBe(false);
    expect(mode.isSyntheticPreviewMode()).toBe(false);
    expect(mode.isSyntheticReadMode()).toBe(false);
  });
  it("preserves the existing local demo", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEMO_MODE", "true");
    const mode = await import("@/lib/env");
    expect(mode.isDemoMode()).toBe(true);
    expect(mode.isSyntheticPreviewMode()).toBe(false);
    expect(mode.isSyntheticReadMode()).toBe(true);
  });
  it("allows synthetic reads in production without granting local demo or Supabase access", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("SYNTHETIC_PREVIEW", "true");
    vi.stubEnv("SYNTHETIC_PREVIEW_PURPOSE", "synthetic-read-only");
    vi.stubEnv("NEXT_PUBLIC_SYNTHETIC_PREVIEW", "true");
    const mode = await import("@/lib/env");
    expect(mode.isDemoMode()).toBe(false);
    expect(mode.isSyntheticPreviewMode()).toBe(true);
    expect(mode.isSyntheticReadMode()).toBe(true);
    expect(mode.hasSupabaseConfiguration()).toBe(false);
    expect(mode.hasSupabaseAdminConfiguration()).toBe(false);
  });
});
