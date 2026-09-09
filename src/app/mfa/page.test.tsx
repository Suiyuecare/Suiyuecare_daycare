import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), rpc: vi.fn(),
  challenge: vi.fn(), demo: false, synthetic: false }));
vi.mock("@/lib/env", () => ({ isDemoMode: () => mocks.demo, isSyntheticPreviewMode: () => mocks.synthetic }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/components/auth/mfa-challenge", () => ({ MfaChallenge: mocks.challenge }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
import MfaPage from "./page";

function page(purpose?: string | string[], extra: Record<string, string> = {}) {
  return MfaPage({ searchParams: Promise.resolve({ purpose, ...extra }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.demo = false; mocks.synthetic = false;
  mocks.challenge.mockImplementation(() => <div>驗證器</div>);
  mocks.user.mockResolvedValue({ data: { user: { id: "approved-user", is_anonymous: false } }, error: null });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user }, rpc: mocks.rpc });
});

describe("explicit sensitive-action MFA entrance", () => {
  it("shows the existing challenge only for an explicit action after server-side eligibility", async () => {
    const html = renderToStaticMarkup(await page("sensitive-action"));
    expect(html).toContain("重要操作的額外保護");
    expect(html).toContain("這不是登入必經步驟");
    expect(html).toContain("驗證器");
    expect(html).toContain('href="/app/dashboard"');
    expect(html).not.toContain("才能進入系統");
    expect(mocks.rpc).toHaveBeenCalledWith("can_begin_staff_mfa");
    expect(mocks.challenge).toHaveBeenCalledOnce();
  });
  it.each([undefined, "", "login", "enroll", "https://evil.example", ["sensitive-action"], ["sensitive-action", "login"]])(
    "returns an authorized legacy or invalid-purpose visit to the dashboard without enrollment (%j)", async (purpose) => {
      await expect(page(purpose, { audience: "family", next: "https://evil.example" }))
        .rejects.toThrow("REDIRECT:/app/dashboard");
      expect(mocks.rpc).toHaveBeenCalledWith("can_begin_staff_mfa");
      expect(mocks.challenge).not.toHaveBeenCalled();
    },
  );
  it.each(["demo", "synthetic"])("does not mount the challenge on an ordinary %s visit", async (mode) => {
    if (mode === "demo") mocks.demo = true;
    else mocks.synthetic = true;
    await expect(page()).rejects.toThrow("REDIRECT:/app/dashboard");
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.challenge).not.toHaveBeenCalled();
  });
  it.each([false, null, "true"])("rejects unapproved eligibility %s", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(page()).rejects.toThrow("REDIRECT:/login?error=google_sign_in_failed");
    await expect(page("sensitive-action")).rejects.toThrow("REDIRECT:/login?error=google_sign_in_failed");
    expect(mocks.challenge).not.toHaveBeenCalled();
  });
  it("rejects absent backend or anonymous sessions", async () => {
    mocks.client.mockResolvedValueOnce(null);
    await expect(page("sensitive-action")).rejects.toThrow("REDIRECT:/login");
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    await expect(page("sensitive-action")).rejects.toThrow("REDIRECT:/login");
    mocks.user.mockResolvedValue({ data: { user: { id: "anonymous", is_anonymous: true } }, error: null });
    await expect(page("sensitive-action")).rejects.toThrow("REDIRECT:/login");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("fails closed on policy/provider failure", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: { code: "PGRST202" } });
    await expect(page("sensitive-action")).rejects.toThrow("REDIRECT:/login");
    mocks.user.mockRejectedValue(new Error("private provider detail"));
    await expect(page("sensitive-action")).rejects.toThrow("REDIRECT:/login");
  });
});
