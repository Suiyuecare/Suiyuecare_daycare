import { afterEach, describe, expect, it, vi } from "vitest";

import { assessmentFormHref, assessmentMatrixReady, canViewAssessmentMatrix } from "./config";
import { assessmentMatrixHref, currentTaipeiMonth, parseAssessmentMatrixQuery } from "./query";

afterEach(() => vi.unstubAllEnvs());

describe("assessment matrix filters and scoped links", () => {
  it("keeps the new entry closed until the server release gate is explicitly enabled", () => {
    vi.stubEnv("ASSESSMENT_MATRIX_READY", "");
    expect(assessmentMatrixReady()).toBe(false);
    vi.stubEnv("ASSESSMENT_MATRIX_READY", "false");
    expect(assessmentMatrixReady()).toBe(false);
    vi.stubEnv("ASSESSMENT_MATRIX_READY", "true");
    expect(assessmentMatrixReady()).toBe(true);
  });
  it("uses the Taipei month and preserves month/page in shareable links", () => {
    expect(currentTaipeiMonth(new Date("2026-09-30T16:10:00.000Z"))).toBe("2026-10");
    expect(parseAssessmentMatrixQuery({}, "2026-10")).toEqual({ ok: true, filters: { month: "2026-10", page: 1 } });
    expect(assessmentMatrixHref({ month: "2026-09", page: 3 })).toBe("/app/assessment-matrix?month=2026-09&page=3");
  });

  it("rejects duplicate, malformed, future and excessive filters before querying", () => {
    for (const params of [
      { month: ["2026-09", "2026-10"] }, { month: "2026-13" },
      { month: "2026-11" }, { month: "1999-12" },
      { page: "0" }, { page: "10000" }, { page: ["1", "2"] },
    ]) expect(parseAssessmentMatrixQuery(params, "2026-10").ok).toBe(false);
  });

  it("requires a client read scope plus a questionnaire read scope", () => {
    expect(canViewAssessmentMatrix({ demo: false, scopes: ["clients.read"] })).toBe(false);
    expect(canViewAssessmentMatrix({ demo: false, scopes: ["questionnaire_cognition.read"] })).toBe(false);
    expect(canViewAssessmentMatrix({ demo: false, scopes: ["clients.read", "questionnaire_cognition.read"] })).toBe(true);
  });

  it("maps only known forms to client-scoped destinations", () => {
    const id = "6de34e95-f542-4bf8-9bd0-8e1acb5551b4";
    expect(assessmentFormHref("mna_sf", id)).toBe(`/app/staff/professional-care/mna?client=${id}`);
    expect(assessmentFormHref("unknown" as "spmsq", id)).toBeNull();
  });
});
