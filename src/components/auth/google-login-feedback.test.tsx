import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const query = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(query.value) }));
import { GoogleLoginFeedback } from "./google-login-feedback";

describe("Google login feedback", () => {
  it("shows a useful generic failure without reflecting provider or account details", () => {
    query.value = "error=google_sign_in_failed&error_description=private-provider-token&email=private@example.test&next=https://evil.example";
    const html = renderToStaticMarkup(<GoogleLoginFeedback />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Google 登入未完成或此帳號未獲授權");
    expect(html).not.toContain("private");
    expect(html).not.toContain("evil.example");
  });

  it.each(["", "error=private-provider-token", "audience=family&role=admin"])("ignores unrecognized query values: %s", (value) => {
    query.value = value;
    expect(renderToStaticMarkup(<GoogleLoginFeedback />)).toBe("");
  });

  it("explains the one-time Google activation required by a pending Daycare approval", () => {
    query.value = "error=portal_activation_required&email=private@example.test";
    const html = renderToStaticMarkup(<GoogleLoginFeedback />);
    expect(html).toContain("日照首次使用");
    expect(html).toContain("Google 帳號快速登入");
    expect(html).not.toContain("private@example.test");
  });

  it("shows a generic Portal handoff recovery action without leaking ticket details", () => {
    query.value = "error=portal_handoff_failed&payload=secret-ticket";
    const html = renderToStaticMarkup(<GoogleLoginFeedback />);
    expect(html).toContain("從公司模組入口重新進入");
    expect(html).not.toContain("secret-ticket");
  });
});
