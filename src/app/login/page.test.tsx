import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/env", () => ({
  isDemoMode: () => false,
  isSyntheticPreviewMode: () => false,
}));
vi.mock("@/components/auth/login-form", () => ({
  LoginForm: ({ demoMode }: { demoMode: boolean }) => (
    <form aria-label="登入表單" data-demo={String(demoMode)} />
  ),
}));

import LoginPage from "./page";

describe("authenticated validation release entrance", () => {
  it("keeps normal authentication and clearly disallows real client data", () => {
    const html = renderToStaticMarkup(LoginPage());
    expect(html).toContain('aria-label="版本使用限制"');
    expect(html).toContain("尚未完成正式營運驗收");
    expect(html).toContain("請勿輸入或上傳真實個案資料");
    expect(html).toContain('data-demo="false"');
    expect(html).not.toContain("合成資料線上試用");
    expect(html).not.toContain('href="/app/dashboard"');
  });
});
