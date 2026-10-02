import { describe, expect, it } from "vitest";

import { answered, missingAnswer, scoreAssessment } from "./engine";
import { getAssessmentDefinition } from "./definitions";
import { ASSESSMENT_TEST_VECTORS } from "./test-vectors";

function vector(id: string) {
  const found = ASSESSMENT_TEST_VECTORS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing test vector ${id}`);
  return found.submission;
}

describe("independent source-reviewed candidate rules, not clinical approval", () => {
  it.each(["lawton-iadl-8-domain-expanded-v2", "bsrs5-zh-tw-v2"])("keeps %s unactivated and review required", (id) => {
    expect(getAssessmentDefinition(id)).toMatchObject({ activatedAt: null, reviewRequired: true, ruleRevision: 2 });
  });

  it("keeps IADL v1 historical score while v2 uses the seven corrected original-table options", () => {
    const candidate = vector("iadl-v2-partial-function-options");
    expect(scoreAssessment(candidate).score?.raw).toBe(8);
    expect(scoreAssessment({ ...candidate, versionId: "lawton-iadl-8-domain-expanded-v1" }).score?.raw).toBe(3);
  });

  it.each([
    ["telephone", "telephone_answer_only"],
    ["housekeeping", "housework_light_tasks"],
    ["housekeeping", "housework_below_standard"],
    ["housekeeping", "housework_all_help"],
    ["laundry", "laundry_small_items"],
    ["transportation", "transport_with_companion"],
    ["finances", "finances_daily_only"],
  ])("maps original-table %s/%s to 1 without rewriting the v1 definition", (id, choice) => {
    const old = getAssessmentDefinition("lawton-iadl-8-domain-expanded-v1")!.items.find((item) => item.id === id)!;
    const corrected = getAssessmentDefinition("lawton-iadl-8-domain-expanded-v2")!.items.find((item) => item.id === id)!;
    expect(old.choices.find((item) => item.value === choice)?.points).toBe(0);
    expect(corrected.choices.find((item) => item.value === choice)?.points).toBe(1);
  });

  it("preserves the historical BSRS v1 15-point band instead of silently changing its interpretation", () => {
    const candidate = vector("bsrs-v2-fifteen-boundary");
    expect(scoreAssessment(candidate).classification?.key).toBe("high_15_20");
    expect(scoreAssessment({ ...candidate, versionId: "bsrs5-zh-tw-v1" }).classification?.key).toBe("moderate_10_15");
  });

  it.each([
    [0, "adaptation_0_5"], [5, "adaptation_0_5"], [6, "mild_6_9"], [9, "mild_6_9"],
    [10, "moderate_10_14"], [14, "moderate_10_14"], [15, "high_15_20"], [20, "high_15_20"],
  ])("reproduces official candidate total %d and band %s", (total, band) => {
    let remaining = total;
    const answers = Object.fromEntries(Array.from({ length: 5 }, (_, index) => {
      const score = Math.min(4, remaining);
      remaining -= score;
      return [`bsrs_${String(index + 1).padStart(2, "0")}`, answered(String(score))];
    }));
    const result = scoreAssessment({ versionId: "bsrs5-zh-tw-v2", answers: { ...answers, bsrs_suicide: answered("0") } });
    expect(result.score?.raw).toBe(total);
    expect(result.classification?.key).toBe(band);
  });

  it.each(["1", "2", "3", "4"])("requires independent human acknowledgement for safety answer %s even if total is zero", (value) => {
    const candidate = vector("bsrs-v2-safety-item-not-summed");
    const result = scoreAssessment({ ...candidate, answers: { ...candidate.answers, bsrs_suicide: answered(value) } });
    expect(result.score?.raw).toBe(0);
    expect(result.alerts).toContainEqual(expect.objectContaining({
      code: Number(value) >= 2 ? "BSRS_SUICIDE_PROFESSIONAL_REVIEW" : "BSRS_SUICIDE_CONCERN_REVIEW",
      requiresAcknowledgement: true,
    }));
  });

  it("does not suppress a known safety concern when another question is missing", () => {
    const candidate = vector("bsrs-v2-safety-item-not-summed");
    const result = scoreAssessment({ ...candidate, answers: { ...candidate.answers, bsrs_01: missingAnswer() } });
    expect(result.status).toBe("incomplete");
    expect(result.score?.raw).toBeNull();
    expect(result.alerts).toContainEqual(expect.objectContaining({ code: "BSRS_SUICIDE_PROFESSIONAL_REVIEW", requiresAcknowledgement: true }));
  });

  it("does not suppress a known safety concern when another question has an invalid value", () => {
    const candidate = vector("bsrs-v2-safety-item-not-summed");
    const result = scoreAssessment({ ...candidate, answers: { ...candidate.answers, bsrs_01: answered("99") } });
    expect(result.status).toBe("invalid");
    expect(result.score?.raw).toBeNull();
    expect(result.alerts).toContainEqual(expect.objectContaining({ code: "BSRS_SUICIDE_PROFESSIONAL_REVIEW", requiresAcknowledgement: true }));
  });

  it.each(["0", "5", "invalid"])("never turns zero or invalid safety %s into a positive source-derived answer", (value) => {
    const candidate = vector("bsrs-v2-safety-item-not-summed");
    const result = scoreAssessment({ ...candidate, answers: { ...candidate.answers, bsrs_suicide: answered(value) } });
    expect(result.alerts.some((alert) => alert.code.startsWith("BSRS_SUICIDE"))).toBe(false);
    expect(result.status).toBe(value === "0" ? "complete" : "invalid");
  });

  it("keeps old v1 safety behavior reproducible but never represents it as reviewed v2", () => {
    const candidate = vector("bsrs-v2-safety-item-not-summed");
    const result = scoreAssessment({ ...candidate, versionId: "bsrs5-zh-tw-v1" });
    expect(result.alerts.some((alert) => alert.code.startsWith("BSRS_SUICIDE"))).toBe(false);
    expect(result.rule?.versionId).toBe("bsrs5-zh-tw-v1");
  });
});
