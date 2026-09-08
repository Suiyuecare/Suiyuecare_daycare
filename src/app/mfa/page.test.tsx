import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/env", () => ({ isDemoMode: () => false, isSyntheticPreviewMode: () => false }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/components/auth/mfa-challenge", () => ({ MfaChallenge: () => <div>驗證器</div> }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
import MfaPage from "./page";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: "approved-user", is_anonymous: false } }, error: null });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user }, rpc: mocks.rpc });
});

describe("executive MFA entrance", () => {
  it("shows MFA only after server-side eligibility", async () => {
    expect(renderToStaticMarkup(await MfaPage())).toContain("執行長仍須完成雙因素驗證");
    expect(mocks.rpc).toHaveBeenCalledWith("can_begin_staff_mfa");
  });
  it.each([false, null, "true"])("rejects unapproved eligibility %s", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(MfaPage()).rejects.toThrow("REDIRECT:/login?error=google_sign_in_failed");
  });
  it("rejects absent backend or anonymous sessions", async () => {
    mocks.client.mockResolvedValueOnce(null);
    await expect(MfaPage()).rejects.toThrow("REDIRECT:/login");
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    await expect(MfaPage()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("fails closed on policy/provider failure", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: { code: "PGRST202" } });
    await expect(MfaPage()).rejects.toThrow("REDIRECT:/login");
    mocks.user.mockRejectedValue(new Error("private provider detail"));
    await expect(MfaPage()).rejects.toThrow("REDIRECT:/login");
  });
});
