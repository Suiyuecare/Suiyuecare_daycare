import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

describe("Finance production theme contract (5f6820a, verified 2026-09-24)", () => {
  it.each([
    ["admin-orange", "#ea880c"],
    ["admin-orange-dark", "#b45309"],
    ["admin-brown", "#2f2a26"],
    ["admin-muted", "#6e6259"],
    ["admin-paper", "#fff9f2"],
    ["admin-cream", "#ffe7c2"],
    ["admin-line", "#f1cfa8"],
    ["admin-soft", "#fff4e4"],
  ])("preserves --%s as %s", (token, value) => {
    expect(css).toContain(`--${token}: ${value};`);
  });

  it("retains Finance frame sizes and mobile drawer breakpoint", () => {
    expect(css).toContain("--sidebar: 300px;");
    expect(css).toContain("--header-height: 82px;");
    expect(css).toContain("--header-height: 96px;");
    expect(css).toContain("--sidebar: 240px; --content-padding: 24px;");
    expect(css).toContain("--sidebar: 196px;");
    expect(css).toContain("--sidebar: 0px; --header-height: 56px;");
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

  it("uses the current production rectangular controls and cards, not the superseded pill theme", () => {
    expect(css).toContain("--control-radius: 10px;");
    expect(css).toContain("--card-radius: 10px;");
    expect(css).toMatch(/\.button \{[^}]+min-height: 44px;[^}]+border-radius: var\(--control-radius\);/u);
    expect(css).toMatch(/\.panel \{[^}]+border-radius: var\(--card-radius\);/u);
    expect(css).toMatch(/\.status-pill \{[^}]+border-radius: var\(--control-radius\);/u);
    expect(css).toMatch(/\.avatar \{[^}]+border-radius: 6px;/u);
  });

  it("matches header ordering and hover colors without removing mobile focus clearance", () => {
    expect(css).toContain("grid-template-columns: max-content max-content max-content minmax(0, 1fr);");
    expect(css).toContain('grid-template-areas: "title bell actions status";');
    expect(css).toContain(".nav-link:hover { background: var(--brand); color: white;");
    expect(css).toContain("scroll-padding-bottom: calc(92px + env(safe-area-inset-bottom, 0px));");
    expect(css).toMatch(/\.topbar__date \{[^}]+text-overflow: ellipsis;/u);
  });

  it("preserves semantic success, warning and danger independently of brand", () => {
    expect(css).toContain("--success: #2a6010;");
    expect(css).toContain("--warning: #7a4500;");
    expect(css).toContain("--danger: #8a1010;");
  });
});
