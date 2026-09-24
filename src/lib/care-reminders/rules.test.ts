import { describe, expect, it } from "vitest";
import { parseCentralCareHtml } from "@/lib/imports/parser";
import { validateHtmlImportFile } from "@/lib/imports/validation";
import { CURRENT_MAPPING_VERSION } from "@/lib/imports/types";
import { suggestCareReminders } from "./rules";

export function reminderFixture(value = "需要協助", extra = "") {
  return parseCentralCareHtml(validateHtmlImportFile({ fileName: "synthetic-attention.html", mimeType: "text/html",
    bytes: new TextEncoder().encode(`<html><h5>E.日常活動功能</h5><table><tr><th>移位</th><td>${value}</td></tr>${extra}</table></html>`),
  }), CURRENT_MAPPING_VERSION);
}

describe("explicit CMS attention rules", () => {
  it.each([
    ["E.日常活動功能", "E1.吃飯 ※ (不包含自行準備食物、餐具或盛裝食物等)", "2.需要一些協助 ※ 5分", "cms.explicit_meal_assistance"],
    ["E.日常活動功能", "E7.上廁所", "2.需協助整理衣物或使用衛生紙或需協助清理便盆(尿壺) ※ 5分", "cms.explicit_toileting_assistance"],
    ["E.日常活動功能", "E8.移位", "2.移位時需少部分協助或提醒 ※ 10分", "cms.explicit_transfer_assistance"],
    ["C.個案溝通能力", "C4.個案表達能力(包含語言或非語言)", "2.僅可表達簡單的意思", "cms.explicit_communication_assistance"],
    ["C.個案溝通能力", "C4.個案表達能力(包含語言或非語言)", "3.雖能表達簡單的意思,但多數難以理解", "cms.explicit_communication_assistance"],
  ])("accepts locally verified exact source labels and whole options: %s / %s / %s", (heading, label, value, ruleId) => {
    const parsed = parseCentralCareHtml(validateHtmlImportFile({ fileName: "synthetic-coded-option.html", mimeType: "text/html",
      bytes: new TextEncoder().encode(`<html><h5>${heading}</h5><table><tr><th>${label}</th><td>${value}</td></tr></table></html>`),
    }), CURRENT_MAPPING_VERSION);
    expect(parsed.fields[0]!.source.label).toBe(label);
    expect(suggestCareReminders(parsed.fields, parsed.mappingVersion)).toMatchObject([{ruleId, sourceValue:value}]);
  });
  it("does not infer coded assistance from a bare option number or normal wording", () => {
    for (const value of ["1.良好", "1.可自行完成", "2", "5分", "2.需要一些協助 ※ 5分（但已恢復）"]) {
      const parsed = reminderFixture(); parsed.fields[0]!.normalizedValue = value;
      expect(suggestCareReminders(parsed.fields, parsed.mappingVersion)).toEqual([]);
    }
  });
  it("produces a provenance-linked review candidate from an exact structured option", () => {
    const parsed = reminderFixture();
    const result = suggestCareReminders(parsed.fields, parsed.mappingVersion);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ ruleId: "cms.explicit_transfer_assistance", fieldId: parsed.fields[0]!.id,
      sourceValue: "需要協助", parentPath: parsed.fields[0]!.source.parentPath, ruleVersion: "cms-explicit-attention@1" });
    expect(result[0]!.text).not.toMatch(/診斷|注射|劑量|增量/u);
  });
  it.each(["", "不適用", "未評估", "不知道", "不需要協助", "可自行完成", "0", "1", "3", "需要協助，請加藥", "昨日需要協助但今日正常", "<script>需要協助</script>"])("does not infer meaning from missing, negated, numeric or free text: %s", (value) => {
    const parsed = reminderFixture(value);
    expect(suggestCareReminders(parsed.fields, parsed.mappingVersion)).toEqual([]);
  });
  it("blocks conflicting values even across different source parents", () => {
    const parsed = reminderFixture("需要協助", '<tr><th>移位</th><td>不需要協助</td></tr>');
    expect(suggestCareReminders(parsed.fields, parsed.mappingVersion)).toEqual([]);
  });
  it.each(["unknown", "conflict"] as const)("never accepts mapping state %s", (mappingState) => {
    const parsed = reminderFixture(); parsed.fields[0]!.mappingState = mappingState;
    expect(suggestCareReminders(parsed.fields, parsed.mappingVersion)).toEqual([]);
  });
  it("blocks warnings, unrelated parent paths and tampered mapping keys", () => {
    for (const edit of [
      (field: ReturnType<typeof reminderFixture>["fields"][number]) => { field.warnings = ["UNCERTAIN"]; },
      (field: ReturnType<typeof reminderFixture>["fields"][number]) => { field.source.parentPath = "OTHER/root"; },
      (field: ReturnType<typeof reminderFixture>["fields"][number]) => { field.mappingKey = "forged"; },
    ]) {
      const parsed = reminderFixture(); edit(parsed.fields[0]!);
      expect(suggestCareReminders(parsed.fields, parsed.mappingVersion)).toEqual([]);
    }
  });
  it("does not silently apply another mapping version", () => {
    expect(suggestCareReminders(reminderFixture().fields, "central-care-plan-html@future")).toEqual([]);
  });
  it("blocks a persisted existing-value conflict even when a generic mapper says mapped", () => {
    const parsed = reminderFixture();
    expect(suggestCareReminders(parsed.fields, parsed.mappingVersion, [parsed.fields[0]!.mappingKey])).toEqual([]);
  });
});
