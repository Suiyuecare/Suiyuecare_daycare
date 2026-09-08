import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/env", () => ({ isDemoMode: () => false, isSyntheticPreviewMode: () => true }));
vi.mock("@/components/auth/login-form", () => ({ LoginForm: () => { throw new Error("PREVIEW_MUST_NOT_MOUNT_LOGIN_FORM"); } }));
import LoginPage from "@/app/login/page";

describe("synthetic preview entrance", () => {
  it("offers only fixed reading entrances and never asks for real credentials", () => {
    const html = renderToStaticMarkup(LoginPage());
    expect(html).toContain('href="/app/dashboard"');
    expect(html).toContain('href="/family/home"');
    expect(html).toContain("禁止輸入或上傳真實個資");
    expect(html).toContain("不保存或傳送業務資料");
    expect(html).not.toMatch(/<(?:input|form|textarea)\b/u);
  });
});
