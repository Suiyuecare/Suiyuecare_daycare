import { describe, expect, it } from "vitest";

import {
  GDS15_INSTRUCTIONS,
  GDS15_QUESTIONS,
  SPMSQ_ADMINISTRATION_NOTES,
  SPMSQ_QUESTIONS,
} from "./question-content";

describe("licensed Traditional Chinese question content", () => {
  it("contains ten SPMSQ prompts and administration notes", () => {
    expect(SPMSQ_QUESTIONS).toHaveLength(10);
    expect(SPMSQ_ADMINISTRATION_NOTES).toHaveLength(10);
    expect(SPMSQ_QUESTIONS[3]).toContain("沒有電話");
    expect(SPMSQ_QUESTIONS[9]).toContain("20 減 3");
  });

  it("contains the complete GDS-15 text with its recall period", () => {
    expect(GDS15_INSTRUCTIONS).toContain("最近一週");
    expect(GDS15_QUESTIONS).toHaveLength(15);
    expect(GDS15_QUESTIONS[0]).toContain("生活滿意");
    expect(GDS15_QUESTIONS[14]).toContain("比您幸福");
  });
});
