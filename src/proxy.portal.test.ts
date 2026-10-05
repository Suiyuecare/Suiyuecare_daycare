import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  env: {
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_ORIGIN: "https://daycare.example.test",
    NEXT_PUBLIC_SUPABASE_URL: "https://auth-project.supabase.co",
    PORTAL_DAYCARE_HANDOFF_SECRET: "synthetic-dedicated-handoff-secret-at-least-32-bytes",
  },
  createServerClient: vi.fn(), getClaims: vi.fn(), demo: false,
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@/lib/env", () => ({
  env: mocks.env,
  hasSupabaseAdminConfiguration: () => true,
  isDemoMode: () => mocks.demo,
  isSyntheticPreviewMode: () => false,
}));

import { proxy } from "./proxy";

const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const oldKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
function request(path: string, options: { method?: string; accept?: string; prefetch?: boolean } = {}) {
  return new NextRequest(`https://daycare.example.test${path}`, {
    method: options.method ?? "GET",
    headers: {
      accept: options.accept ?? "text/html,application/xhtml+xml",
      ...(options.prefetch ? { "next-router-prefetch": "1" } : {}),
    },
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "synthetic-publishable-key";
  mocks.demo = false;
  mocks.env.PORTAL_DAYCARE_HANDOFF_SECRET = "synthetic-dedicated-handoff-secret-at-least-32-bytes";
  mocks.getClaims.mockResolvedValue({ data: { claims: null }, error: null });
  mocks.createServerClient.mockReturnValue({ auth: { getClaims: mocks.getClaims } });
});
afterEach(() => {
  if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
  if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = oldKey;
});

describe("direct Daycare work links through company Portal", () => {
  it("takes a signed-out document navigation to the exact Portal tile with safe deep link", async () => {
    const response = await proxy(request("/app/staff/assessments/physical?tab=today"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://login.suiyuecare.com");
    expect(location.pathname).toBe("/portal/");
    expect(location.searchParams.get("module")).toBe("day-care");
    expect(location.searchParams.get("next")).toBe("/app/staff/assessments/physical?tab=today");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(location.search).not.toContain("access_token");
  });

  it("keeps a locally authenticated session on Daycare without another Portal hop", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user" } }, error: null });
    const response = await proxy(request("/app/dashboard"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it.each([
    ["/login", "GET", "text/html", false],
    ["/app/dashboard", "POST", "text/html", false],
    ["/app/dashboard", "GET", "text/x-component", false],
    ["/app/dashboard", "GET", "text/html", true],
    ["/api/auth/handoff", "GET", "text/html", false],
  ] as const)("does not redirect local sign-out, mutations, RSC, prefetch or API: %s", async (path, method, accept, prefetch) => {
    const response = await proxy(request(path, { method, accept, prefetch }));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("fails closed to local login if the dedicated handoff secret is not configured", async () => {
    mocks.env.PORTAL_DAYCARE_HANDOFF_SECRET = "short";
    const response = await proxy(request("/app/dashboard"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("never forwards a URL-like or unsafe query as a Portal return destination", async () => {
    const response = await proxy(request("/app/dashboard?next=//evil.example"));
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("next")).toBe("/app");
  });
});
