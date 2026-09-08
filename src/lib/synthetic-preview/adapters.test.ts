import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ server: vi.fn(), browser: vi.fn(), admin: vi.fn(), cookies: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic", SUPABASE_SECRET_KEY: "synthetic" },
  isSyntheticPreviewMode: () => true, hasSupabaseConfiguration: () => true, hasSupabaseAdminConfiguration: () => true }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.server, createBrowserClient: mocks.browser }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.admin }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("preview cannot obtain a live Supabase adapter even when called directly", () => {
  it("refuses the server and admin clients before cookies or SDK calls", async () => {
    expect(await createServerSupabaseClient()).toBeNull();
    expect(createSupabaseAdminClient()).toBeNull();
    expect(mocks.server).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
  });
  it("refuses the browser client even with contaminated public credentials", () => {
    vi.stubEnv("NEXT_PUBLIC_SYNTHETIC_PREVIEW", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic");
    expect(createBrowserSupabaseClient()).toBeNull();
    expect(mocks.browser).not.toHaveBeenCalled();
  });
});
