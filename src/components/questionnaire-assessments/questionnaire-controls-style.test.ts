import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("questionnaire editable control typography", () => {
  it("keeps entered dates, measurements, context and qualitative reasons at 16px without resizing the frame", () => {
    const css = readFileSync(new URL("./questionnaire-assessments.module.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.meta input,\s*\.measurements input,\s*\.measurements select,\s*\.notes textarea\s*\{\s*font-size:\s*1rem;\s*\}/u);
    expect(css).toMatch(/\.notes textarea\s*\{[^}]*resize:\s*none;/u);
  });
});
