import { describe, expect, it } from "vitest";
import { filterImportReadinessFields, summarizeImportReadiness, type ImportReadinessInput } from "./readiness";
import type { ImportPreviewField } from "./types";

function field(id: string, mappingState: ImportPreviewField["mappingState"], parentPath = "section/a"): ImportPreviewField {
  return { id, mappingState, mappingKey: `key.${id}`, targetPath: null, displayValue: "", isMasked: false,
    source: { sectionCode: "A", sectionTitle: "來源", label: id, parentPath, controlName: null }, warnings: [] };
}
const input: ImportReadinessInput = { fields: [field("a", "mapped"), field("b", "unknown"), field("c", "conflict")], sections: [], warnings: [], conflictCount: 1, mappingVersion: "test@1" };

describe("parser readiness, not formal data readiness", () => {
  it("partitions fields without adding conflict groups or warnings into the denominator", () => {
    const result = summarizeImportReadiness(input);
    expect(result.fieldTotal).toBe(result.mapped + result.unknown + result.conflict);
    expect(result.fieldTotal).toBe(3); expect(result.conflictGroups).toBe(1);
    expect(result.status).toBe("needs_review"); expect(result.canPromote).toBe(false);
  });
  it("never declares clean candidate mappings ready for official promotion", () => {
    const result = summarizeImportReadiness({ ...input, fields: [field("a", "mapped")], conflictCount: 0 });
    expect(result.status).toBe("parsed_only"); expect(result.canPromote).toBe(false);
  });
  it("empty data does not count as complete", () => {
    expect(summarizeImportReadiness({ ...input, fields: [], conflictCount: 0 }).hasOpenParserIssues).toBe(true);
  });
  it("keeps unknown sections even when they contain no fields", () => {
    const result = summarizeImportReadiness({ ...input, fields: [field("a", "mapped")], conflictCount: 0,
      sections: [{ id: "u", index: 0, code: "UNKNOWN", title: "未知", sourceHeadingId: null, recognized: false }] });
    expect(result.unrecognizedSections).toBe(1); expect(result.status).toBe("needs_review");
  });
  it("retains blocking group conflicts without field flags", () => {
    expect(summarizeImportReadiness({ ...input, fields: [field("a", "mapped")] }).status).toBe("needs_review");
  });
  it("separates errors from non-error warnings", () => {
    const result = summarizeImportReadiness({ ...input, warnings: [
      { id: "1", code: "E", severity: "error", message: "錯誤" }, { id: "2", code: "W", severity: "warning", message: "警示" }] });
    expect(result.errorWarnings).toBe(1); expect(result.warningTotal).toBe(2);
  });
  it.each(["mapped", "unknown", "conflict"] as const)("filters %s without mutating snapshot totals", (status) => {
    expect(filterImportReadinessFields(input.fields, status, "all")).toHaveLength(1);
    expect(summarizeImportReadiness(input).fieldTotal).toBe(3);
  });
  it("combines status with exact parent path and preserves input order", () => {
    const fields = [field("1", "mapped", "A"), field("2", "mapped", "B"), field("3", "unknown", "B")];
    expect(filterImportReadinessFields(fields, "mapped", "B").map((entry) => entry.id)).toEqual(["2"]);
    expect(filterImportReadinessFields(fields, "all", "missing")).toEqual([]);
  });
});
