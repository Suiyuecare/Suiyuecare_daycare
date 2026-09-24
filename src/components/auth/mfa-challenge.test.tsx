// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listFactors: vi.fn(), enroll: vi.fn(), challenge: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("purpose=sensitive-action"),
}));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabaseClient: () => ({
  auth: { mfa: { listFactors: mocks.listFactors, enroll: mocks.enroll, challenge: mocks.challenge } },
}) }));

import { MfaChallenge } from "./mfa-challenge";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable-key");
  mocks.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
  mocks.enroll.mockResolvedValue({ data: { id: "synthetic-factor", totp: {
    qr_code: "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E",
    secret: "SYNTHETIC-TEST-KEY",
  } }, error: null });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe("sensitive-action authenticator setup copy", () => {
  it("labels enrollment as an important operation, not a first-login requirement", async () => {
    render(<MfaChallenge />);
    expect(await screen.findByRole("heading", { name: "重要操作：設定驗證器" })).toBeVisible();
    expect(screen.queryByText(/第一次登入/u)).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "雙因素驗證 QR Code" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "驗證碼" })).toHaveAttribute("maxLength", "6");
    expect(screen.getByRole("button", { name: "完成驗證" })).toBeEnabled();
    expect(mocks.enroll).toHaveBeenCalledExactlyOnceWith({ factorType: "totp", friendlyName: "日照管理系統" });
    expect(mocks.challenge).not.toHaveBeenCalled();
  });
});
