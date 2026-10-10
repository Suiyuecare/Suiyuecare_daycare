import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const layout = readFileSync(resolve(process.cwd(), "src/app/layout.tsx"), "utf8");

describe("Suiyue APM / Finance CIS contract", () => {
  it.each([
    ["admin-orange", "#ea880c"],
    ["admin-orange-dark", "#b45309"],
    ["admin-brown", "#2f2a26"],
    ["admin-muted", "#6e6259"],
    ["admin-paper", "#f7f3ec"],
    ["admin-cream", "#ffe7c2"],
    ["admin-line", "#f1cfa8"],
    ["admin-soft", "#fff4e4"],
  ])("preserves --%s as %s", (token, value) => {
    expect(css).toContain(`--${token}: ${value};`);
  });

  it("loads APM's Noto Sans TC and shares its page typography", () => {
    expect(layout).toContain('import { Noto_Sans_TC } from "next/font/google";');
    expect(layout).toContain('className={notoSansTc.variable}');
    expect(css).toContain('--font-sans: var(--font-noto-sans-tc), "Noto Sans TC"');
    expect(css).toContain("font-size: 16px; font-optical-sizing: auto;");
  });

  it("retains the branch-aware shell with APM desktop and mobile header sizes", () => {
    expect(css).toContain("--sidebar: 300px;");
    expect(css).toContain("--header-height: 82px;");
    expect(css).toContain("--header-height: 96px;");
    expect(css).toContain("--sidebar: 240px; --content-padding: 24px;");
    expect(css).toContain("--sidebar: 196px;");
    expect(css).toContain("--sidebar: 0px; --header-height: 64px;");
    expect(css).toContain("width: min(82vw, 352px)");
    expect(css).toContain("height: calc(68px + env(safe-area-inset-bottom, 0px))");
  });

  it("preserves Finance's indeterminate bar, with reduced-motion support", () => {
    expect(css).toMatch(/\.module-loading__bar \{ height: 6px;/u);
    expect(css).toMatch(/\.module-loading__bar b \{[^}]+width: 44%;/u);
    expect(css).toContain("animation: authLoading 1.1s ease-in-out infinite alternate;");
    expect(css).toContain("from { transform: translateX(-80%); } to { transform: translateX(210%); }");
    expect(css).toContain(".module-loading__card > span { display: block; color: #8b7358;");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]+\.module-loading__bar b \{ animation: none;/u);
  });

  it("keeps route-change feedback in a small corner instead of blanketing the old page", () => {
    const transition = css.match(/\.module-loading--transition \{([^}]*)\}/u)?.[1];
    expect(transition).toContain("position: fixed;");
    expect(transition).toContain("width: min(300px,");
    expect(transition).toContain("background: transparent;");
    expect(transition).toContain("pointer-events: none;");
    expect(transition).not.toMatch(/\binset:/u);
    expect(css).toContain(".module-loading--transition .module-loading__bar { height: 3px;");
    expect(css).toContain(".module-loading--transition { top: calc(var(--header-height) + 8px);");
    expect(css).toContain("body:has(.family-shell) .module-loading--transition { top: 80px;");
  });

  it("uses APM 8px controls, 10px cards, and touch-sized actions", () => {
    expect(css).toContain("--control-radius: 8px;");
    expect(css).toContain("--card-radius: 10px;");
    expect(css).toMatch(/\.button \{[^}]+min-height: 44px;[^}]+border-radius: var\(--control-radius\);/u);
    expect(css).toMatch(/\.panel \{[^}]+border-radius: var\(--card-radius\);/u);
    expect(css).toMatch(/\.status-pill \{[^}]+border-radius: var\(--control-radius\);/u);
    expect(css).toMatch(/\.avatar \{[^}]+border-radius: 6px;/u);
    expect(css).toContain(".topbar__actions .button { min-height: 44px;");
  });

  it("matches APM header density while retaining Daycare's safe branch and mobile focus behavior", () => {
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) max-content max-content minmax(0, max-content);");
    expect(css).toContain('grid-template-areas: "title bell actions status";');
    expect(css).toContain(".nav-link:hover { background: var(--brand-soft); color: var(--brand-strong);");
    expect(css).toContain('.nav-link[aria-current="page"] { background: var(--brand-strong); color: white;');
    expect(css).toContain(".branch-switcher--compact .branch-switcher__button { width: 100%; max-width: none;");
    expect(css).toContain(".branch-switcher__button .branch-switcher__current-branch");
    expect(css).toContain(".topbar .notification-button { width: 44px; height: 44px; border-radius: 10px; }");
    expect(css).toContain(".mobile-primary-nav a, .mobile-primary-nav button { display: flex;");
    expect(css).toContain("color: var(--ink-muted); font-size: 11px; font-weight: 700;");
    expect(css).toContain('.mobile-primary-nav [aria-current="page"] { background: #fff1df; color: var(--brand-strong);');
    expect(css).toContain('.family-bottom-nav a[aria-current="page"] { background: #fff1df; color: var(--brand-strong); }');
    expect(css).toContain("scroll-padding-bottom: calc(92px + env(safe-area-inset-bottom, 0px));");
    expect(css).toMatch(/\.topbar__date \{[^}]+text-overflow: ellipsis;/u);
  });

  it("preserves semantic success, warning and danger independently of brand", () => {
    expect(css).toContain("--success: #2a6010;");
    expect(css).toContain("--warning: #7a4500;");
    expect(css).toContain("--danger: #8a1010;");
  });

  it("keeps the APM scrollbar theme available to every work surface and native high contrast", () => {
    expect(css).toContain("html, body, body * { scrollbar-color: var(--line) transparent; scrollbar-width: auto; }");
    expect(css).toContain("::-webkit-scrollbar-thumb:hover { background: var(--ink-muted); }");
    expect(css).toContain("@media (forced-colors: active) { html, body, body * { scrollbar-color: auto; } }");
  });
});
