import { describe, expect, it } from "vitest";
import { assessmentFormHref } from "@/lib/assessment-matrix/config";
import { parseQuestionnaireSelection, questionnaireHistoryHref } from "./query";

const client = "00000000-0000-4000-8000-000000000015";
const version = "00000000-0000-4000-8000-000000000016";
describe("exact questionnaire history selection", () => {
  it("distinguishes new assessment, month and exact version", () => {
    expect(parseQuestionnaireSelection({ month: "2026-09", version })).toEqual({ month: "2026-09", versionId: version, newAssessment: false, historyPage: 1 });
    expect(parseQuestionnaireSelection({ new: "1" })?.newAssessment).toBe(true);
    expect(parseQuestionnaireSelection({})).toEqual({ month: null, versionId: null, newAssessment: false, historyPage: 1 });
  });
  it.each([{ month: "2026-13" }, { version: "fake" }, { new: "true" }, { version, new: "1" }, { month: ["2026-01", "2026-02"] }, { history_page: "0" }, { history_page: "1000001" }])("rejects invalid/ambiguous selection", (input) => {
    expect(parseQuestionnaireSelection(input)).toBeNull();
  });
  it("matrix deep links bind both month and version", () => {
    expect(assessmentFormHref("spmsq", client, "2026-09", version)).toBe(`/app/staff/assessments/spmsq?client=${client}&month=2026-09&version=${version}`);
    expect(assessmentFormHref("spmsq", client, "2026-08")).toBe(`/app/staff/assessments/spmsq?client=${client}&month=2026-08`);
    expect(questionnaireHistoryHref("/app/test", client, { newAssessment: true })).toBe(`/app/test?client=${client}&new=1`);
  });
});
