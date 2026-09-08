import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function headers(enabled: string, supabaseUrl: string) {
  vi.stubEnv("GOOGLE_LOGIN_ENABLED", enabled);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
  vi.stubEnv("SYNTHETIC_PREVIEW", "false");
  vi.stubEnv("NEXT_PUBLIC_SYNTHETIC_PREVIEW", "false");
  const config = (await import("../../../next.config")).default;
  return await config.headers!();
}

describe("Google-only security headers", () => {
  it("keeps provider form redirects disabled until explicitly enabled", async () => {
    const rows = await headers("false", "https://example.supabase.co");
    const csp = rows[0].headers.find(row => row.key === "Content-Security-Policy")!.value;
    expect(csp).toContain("form-action 'self';");
    expect(csp).not.toContain("accounts.google.com");
  });
  it("allows only configured Supabase and Google form redirect origins", async () => {
    const rows = await headers("true", "https://example.supabase.co");
    const csp = rows[0].headers.find(row => row.key === "Content-Security-Policy")!.value;
    expect(csp).toContain("form-action 'self' https://example.supabase.co https://accounts.google.com;");
    expect(csp).not.toContain("*");
  });
  it.each(["", "not-a-url", "https://user:password@example.supabase.co", "https://example.supabase.co/other", "http://example.supabase.co"])(
    "does not broaden form destinations for invalid configuration", async value => {
      const rows = await headers("true", value);
      const csp = rows[0].headers.find(row => row.key === "Content-Security-Policy")!.value;
      expect(csp).toContain("form-action 'self';");
    },
  );
  it("marks every auth endpoint private and excludes callback referrers", async () => {
    const rows = await headers("false", "https://example.supabase.co");
    const auth = rows.find(row => row.source === "/auth/:path*")!.headers;
    expect(auth).toContainEqual({ key: "Cache-Control", value: "private, no-store, max-age=0" });
    expect(auth).toContainEqual({ key: "Referrer-Policy", value: "no-referrer" });
  });
});
