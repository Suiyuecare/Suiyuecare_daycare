import { createServerClient } from "@supabase/ssr";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { GOOGLE_LOGIN_ENABLED: true, NODE_ENV: "production", NEXT_PUBLIC_APP_ORIGIN: "https://daycare.example.test", NEXT_PUBLIC_SUPABASE_URL: "https://auth-project.supabase.co" }, isDemoMode: () => false, isSyntheticPreviewMode: () => false }));
import { googleFlowId, googleLoginConfiguration, newGoogleFlowMarker, validatedGoogleAuthorizationUrl } from "./google-login";

afterEach(() => { vi.restoreAllMocks(); });

describe("pinned Supabase SDK PKCE contract (no external network)", () => {
  it("persists the exact flow verifier before redirect and keeps the callback URL fixed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NETWORK_FORBIDDEN_IN_TEST"));
    const jar = new Map<string, string>();
    const client = createServerClient("https://auth-project.supabase.co", "synthetic-publishable-key", {
      cookies: {
        getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
        setAll: (values) => { for (const { name, value } of values) jar.set(name, value); },
      },
    });
    const result = await client.auth.signInWithOAuth({ provider: "google", options: {
      redirectTo: "https://daycare.example.test/auth/callback", skipBrowserRedirect: true, queryParams: { prompt: "select_account" },
    } });
    expect(result.error).toBeNull();
    const configuration = googleLoginConfiguration(new Request("https://daycare.example.test/auth/google"))!;
    expect(validatedGoogleAuthorizationUrl(result.data.url, configuration)).toBe(result.data.url);
    expect(result.data.flowId).toMatch(/^[a-f0-9]{32}$/u);
    const marker = newGoogleFlowMarker(result.data.flowId)!;
    expect(googleFlowId(marker)).toBe(result.data.flowId);
    expect(jar.has(`sb-auth-project-auth-token-flow-${result.data.flowId}-code-verifier`)).toBe(true);
    expect(new URL(result.data.url!).searchParams.get("redirect_to")).toBe("https://daycare.example.test/auth/callback");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a flow-bound exchange without its verifier fails before a token request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NETWORK_FORBIDDEN_IN_TEST"));
    const client = createServerClient("https://auth-project.supabase.co", "synthetic-publishable-key", {
      cookies: { getAll: () => [], setAll: () => {} },
    });
    const result = await client.auth.exchangeCodeForSession("synthetic-pkce-code", { flowId: "1234567890abcdef1234567890abcdef" });
    expect(result.error).not.toBeNull();
    expect(result.data.session).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects malformed or future flow markers and expires them at ten minutes", () => {
    const now = 1780000000000;
    const marker = newGoogleFlowMarker("1234567890abcdef", now)!;
    expect(googleFlowId(marker, now + 599_000)).toBe("1234567890abcdef");
    expect(googleFlowId(marker, now + 600_000)).toBeNull();
    expect(googleFlowId(marker, now - 1000)).toBeNull();
    expect(newGoogleFlowMarker("invalid/flow", now)).toBeNull();
    expect(newGoogleFlowMarker(null, now)).toBeNull();
  });
});
