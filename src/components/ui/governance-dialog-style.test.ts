import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const bodyCss = readFileSync(new URL("../body-assessments/body-assessments.module.css", import.meta.url), "utf8");
function luminance(hex: string) {
  const values = hex.match(/[a-f\d]{2}/giu)!.map((value) => {
    const channel = Number.parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
describe("canonical confirmation surface contrast", () => {
  it("keeps body-assessment input text and touch targets usable on mobile", () => {
    expect(bodyCss).toMatch(/\.workspace :is\(select,input,textarea\)\s*\{\s*font-size:\s*16px;\s*min-height:\s*44px;\s*\}/u);
    expect(bodyCss).toMatch(/\.workspace textarea\s*\{[^}]*resize:\s*none/u);
  });
  it("reuses the established strong-orange token, scoped to dialogs", () => {
    expect(css).toMatch(/\.core-dialog \.button--primary\s*\{\s*background:\s*var\(--brand-strong\);\s*\}/u);
    expect(css).toMatch(/--brand-strong:\s*var\(--admin-orange-dark\)/u);
  });
  it("provides at least 4.5:1 contrast with existing white button text", () => {
    const token = css.match(/--admin-orange-dark:\s*(#[a-f\d]{6})/iu)![1];
    expect((1.05) / (luminance(token) + 0.05)).toBeGreaterThanOrEqual(4.5);
    expect(css).toMatch(/\.button--primary\s*\{[^}]*color:\s*white/u);
  });
  it("does not replace the Finance header's warm-orange primary background", () => {
    expect(css).toMatch(/\.topbar__actions \.button--primary\s*\{[^}]*background:\s*var\(--brand\)/u);
    expect(css).toMatch(/\.topbar__actions \.button--primary\s*\{[^}]*color:\s*var\(--ink\)/u);
  });
  it("keeps cancel and discard intent readable above screen-local button defaults", () => {
    expect(css).toMatch(/\.core-dialog \.button--secondary\s*\{\s*background:\s*var\(--surface\);\s*color:\s*var\(--ink\);\s*\}/u);
    expect(css).toMatch(/\.core-dialog \.button--danger\s*\{\s*background:\s*var\(--danger-soft\);\s*color:\s*var\(--danger\);\s*\}/u);
    expect(css).toMatch(/\.core-dialog \.drawer__header > \.button\s*\{\s*flex-shrink:\s*0;\s*white-space:\s*nowrap;\s*\}/u);
  });
});
