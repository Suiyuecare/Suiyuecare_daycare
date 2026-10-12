import { describe, expect, it } from "vitest";
import { assessmentFormHref } from "@/lib/assessment-matrix/config";
import { mnaVariantHref, parseMnaVariant, parseQuestionnaireSelection, questionnaireHistoryHref } from "./query";

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
  it("keeps the full instrument through history, pagination and matrix links", () => {
    const path = "/app/staff/professional-care/mna?variant=full";
    expect(questionnaireHistoryHref(path, client, { versionId: version, month: "2026-09" }))
      .toBe(`${path}&client=${client}&version=${version}&month=2026-09`);
    expect(questionnaireHistoryHref(path, client, { historyPage: 2 }))
      .toBe(`${path}&client=${client}&history_page=2`);
    expect(assessmentFormHref("full_mna", client, "2026-09", version))
      .toBe(`${path}&client=${client}&month=2026-09&version=${version}`);
  });
  it("switches instruments without copying history versions or new-record selection", () => {
    expect(mnaVariantHref("full_mna", client, "2026-09"))
      .toBe(`/app/staff/professional-care/mna?variant=full&client=${client}&month=2026-09`);
    expect(mnaVariantHref("mna_sf", client, "2026-09"))
      .toBe(`/app/staff/professional-care/mna?client=${client}&month=2026-09`);
    expect(mnaVariantHref("mna_sf", null)).toBe("/app/staff/professional-care/mna");
    expect(questionnaireHistoryHref(`/app/test?variant=full&version=${version}&new=1&history_page=4`, client))
      .toBe(`/app/test?variant=full&client=${client}`);
  });
  it("rejects unknown or repeated variants instead of falling back to another instrument", () => {
    expect(parseMnaVariant(undefined)).toBe("mna_sf");
    expect(parseMnaVariant("sf")).toBe("mna_sf");
    expect(parseMnaVariant("full")).toBe("full_mna");
    for (const value of ["", "FULL", "other", ["sf", "full"], ["full"]]) expect(parseMnaVariant(value)).toBeNull();
  });
});
