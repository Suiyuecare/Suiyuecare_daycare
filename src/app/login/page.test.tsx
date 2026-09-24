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
    expect(html).toContain("主管已核准的個人公司帳號");
    expect(html).toContain("一般出勤、量測與照顧草稿不需另設驗證器");
    expect(html).toContain("家屬尚未開放登入");
    expect(html).toContain("使用 Google 帳號快速登入");
    expect(html).toContain("分支與個案範圍隔離");
    expect(html).toContain("重要操作另有身分確認要求");
    expect(html).not.toContain("登入後仍須完成雙因素驗證");
    expect(html).not.toContain("員工雙因素驗證");
    expect(html).not.toMatch(/QR|qr.code|掃描|6 位數|\/mfa/iu);
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

  it("matches the company entrance without treating navigation as authorization", () => {
    const html = renderToStaticMarkup(LoginPage());
    expect(html).toContain("歡迎回來");
    expect(html).toContain("日間照顧系統入口");
    expect(html).toContain("歲悅長照集團");
    expect(html).toContain("進入日照時會另外核對日照權限");
    expect(html).toContain('href="https://login.suiyuecare.com/portal/"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toMatch(/portal\/(?:\?|#)|finance-auth|access_token|refresh_token/u);
    expect(html).not.toMatch(/已同步登入|免再次登入|單一登入已啟用/u);
  });
});
