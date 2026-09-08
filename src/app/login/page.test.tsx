import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ env: { GOOGLE_LOGIN_ENABLED: false }, demo: false }));
vi.mock("@/lib/env", () => ({
  env: state.env,
  isDemoMode: () => state.demo,
  isSyntheticPreviewMode: () => false,
}));
vi.mock("@/components/auth/google-login-feedback", () => ({ GoogleLoginFeedback: () => null }));

import LoginPage from "./page";

describe("authenticated validation release entrance", () => {
  beforeEach(() => { state.env.GOOGLE_LOGIN_ENABLED = false; state.demo = false; });

  it("keeps Google-only authentication and clearly disallows real client data", () => {
    const html = renderToStaticMarkup(LoginPage());
    expect(html).toContain('aria-label="版本使用限制"');
    expect(html).toContain("尚未完成正式營運驗收");
    expect(html).toContain("請勿輸入或上傳真實個案資料");
    expect(html).toContain('action="/auth/google"');
    expect(html).toContain('method="post"');
    expect(html).toContain("目前僅開放已核准的執行長帳號");
    expect(html).toContain("登入後仍須完成雙因素驗證");
    expect(html).toContain("Google 登入尚未完成設定");
    expect(html).toContain('disabled=""');
    expect(html).not.toMatch(/<(?:input|textarea)\b/u);
    expect(html).not.toContain("家屬入口");
    expect(html).not.toContain("@suiyuecare.com");
    expect(html).not.toContain("audience=");
    expect(html).not.toContain("合成資料線上試用");
    expect(html).not.toContain('href="/app/dashboard"');
  });

  it("enables only the fixed Google action after explicit provider readiness", () => {
    state.env.GOOGLE_LOGIN_ENABLED = true;
    const html = renderToStaticMarkup(LoginPage());
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('aria-describedby="google-login-readiness"');
    expect(html).toContain("不接受自行註冊或切換角色");
    expect(html).not.toMatch(/name="(?:password|email|phone|otp|role|audience|redirect|next)"/u);
  });

  it("never enables provider authentication in a local demo", () => {
    state.env.GOOGLE_LOGIN_ENABLED = true;
    state.demo = true;
    expect(renderToStaticMarkup(LoginPage())).toContain('disabled=""');
  });
});
