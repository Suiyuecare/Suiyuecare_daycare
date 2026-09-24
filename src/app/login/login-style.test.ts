import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/login/login-page.module.css"), "utf8");

describe("Finance-aligned login layout", () => {
  it("retains desktop proportions and narrow-screen readable controls", () => {
    expect(css).toContain("grid-template-columns: 43% minmax(0, 1fr)");
    expect(css).toContain("max-width: 320px");
    expect(css).toContain("min-height: 52px");
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]+min-height: 56px; font-size: 16px;/u);
    expect(css).toContain("padding: 28px 24px 22px");
    expect(css).toContain("min-height: 100dvh");
    expect(css).not.toMatch(/(?:^|[;{\s])height: 100(?:d)?vh/u);
  });

  it("keeps ordinary intro copy and its keyboard focus above AA contrast", () => {
    expect(css).toContain(".points, .versionNote, .portalIntro { color: #2f2a26; background: rgba(255,255,255,.82); }");
    expect(css).toContain(".portalIntro:hover { background: rgba(255,255,255,.9); }");
    expect(css).toContain("outline: 3px solid #2f2a26; outline-offset: -4px");
    const luminance = (rgb: number[]) => rgb.map((channel) => {
      const value = channel / 255;
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    }).reduce((total, channel, index) => total + channel * [.2126, .7152, .0722][index], 0);
    // Even opaque black under the white .82 surface gives the darkest possible
    // composited background, so this bound covers every point on the gradient.
    const darkestBackground = [255 * .82, 255 * .82, 255 * .82];
    const contrast = (luminance(darkestBackground) + .05) / (luminance([47, 42, 38]) + .05);
    expect(contrast).toBeGreaterThan(4.5);
  });
});
