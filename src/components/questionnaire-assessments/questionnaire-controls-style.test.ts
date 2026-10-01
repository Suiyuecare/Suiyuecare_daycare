import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("questionnaire editable control typography", () => {
  it("keeps entered dates, measurements, context and qualitative reasons at 16px without resizing the frame", () => {
    const css = readFileSync(new URL("./questionnaire-assessments.module.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.meta input,\s*\.measurements input,\s*\.measurements select,\s*\.notes textarea\s*\{\s*font-size:\s*1rem;\s*\}/u);
    expect(css).toMatch(/\.notes textarea\s*\{[^}]*resize:\s*none;/u);
  });

  it("keeps mobile question prompts visible on focus and releases the save bar on short screens", () => {
    const css = readFileSync(new URL("./questionnaire-assessments.module.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.questionCard input\[type="radio"\],\s*\.questionCard \.questionActions button\s*\{\s*scroll-margin-block-start:\s*17rem;/u);
    expect(css).toMatch(/@media \(max-width: 640px\) and \(max-height: 740px\)\s*\{\s*\.mobileSaveActions\s*\{\s*position:\s*static;/u);
  });
});
