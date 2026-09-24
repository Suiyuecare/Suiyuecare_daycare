import { describe, expect, it } from "vitest";
import { customDraftPayloadSchema, parseCustomDraftSave, parseCustomDraftSaveResponse, testCustomForm, type CustomDraftPayload } from "./custom-draft";

const key = "aa100000-0000-4000-8000-000000000001";
const versionId = "aa200000-0000-4000-8000-000000000001";
const definitionId = "aa300000-0000-4000-8000-000000000001";
const payload: CustomDraftPayload = { formKey: "tenant.custom.daily_check", name: "合成自訂表單", category: "行政表單", effectiveFrom: "2026-09-14", effectiveTo: null,
  schema: { builder: "tenant-custom.v1", fields: [
    { key: "note", label: "內容", type: "text", required: true, maxLength: 20 },
    { key: "count", label: "次數", type: "number", required: true, minimum: 0, maximum: 5 },
    { key: "confirmed", label: "確認", type: "boolean", required: true },
    { key: "day", label: "日期", type: "date", required: false },
    { key: "choice", label: "選項", type: "select", required: false, options: ["甲", "乙"] },
  ] } };

describe("custom form draft bounded contract", () => {
  it("accepts institution namespace, dates, fixed types and exact create/update identity", () => {
    expect(parseCustomDraftSave({ formVersionId: null, baseRevision: null, payload }, key)).toMatchObject({ idempotencyKey: key, payload });
    expect(parseCustomDraftSave({ formVersionId: versionId, baseRevision: 1, payload }, key)).toMatchObject({ baseRevision: 1 });
    expect(() => parseCustomDraftSave({ formVersionId: null, baseRevision: 1, payload }, key)).toThrow();
    expect(() => parseCustomDraftSave({ formVersionId: null, baseRevision: null, payload }, null)).toThrow();
  });
  it.each(["official.adl", "tenant.adl", "tenant.custom.X", "tenant.custom.a"]) ("refuses unsupported namespace %s", (formKey) => {
    expect(customDraftPayloadSchema.safeParse({ ...payload, formKey }).success).toBe(false);
  });
  it("refuses executable/rich content and silently ignored metadata", () => {
    for (const extra of [{ scoring: { eval: "alert(1)" } }, { organizationId: key }, { official: true }]) {
      expect(customDraftPayloadSchema.safeParse({ ...payload, ...extra }).success).toBe(false);
    }
    expect(customDraftPayloadSchema.safeParse({ ...payload, name: "<script>run()</script>" }).success).toBe(false);
    expect(customDraftPayloadSchema.safeParse({ ...payload, schema: { ...payload.schema, formula: "1+1" } }).success).toBe(false);
  });
  it("rejects field overflow, duplicate codes/options, reversed numbers and invalid dates", () => {
    const fields = payload.schema.fields;
    for (const invalidFields of [[fields[0], fields[0]], Array(41).fill(fields[0]), [{ ...fields[1], minimum: 10, maximum: 1 }],
      [{ ...fields[4], options: ["甲", "甲"] }], [{ ...fields[0], key: "constructor" }], [{ ...fields[0], formula: "1+1" }]]) {
      expect(customDraftPayloadSchema.safeParse({ ...payload, schema: { ...payload.schema, fields: invalidFields } }).success).toBe(false);
    }
    for (const date of ["2026-02-30", "2026-13-01", "1800-01-01"]) {
      expect(customDraftPayloadSchema.safeParse({ ...payload, effectiveFrom: date }).success).toBe(false);
    }
    expect(customDraftPayloadSchema.safeParse({ ...payload, effectiveTo: "2026-01-01" }).success).toBe(false);
    expect(customDraftPayloadSchema.safeParse({ ...payload, effectiveFrom: null, effectiveTo: "2026-12-01" }).success).toBe(false);
  });
  it("distinguishes missing from zero/false and does not score, mutate or persist answers", () => {
    const answers = Object.freeze({ note: "合成", count: 0, confirmed: false, choice: "乙", day: "2024-02-29" });
    const before = JSON.stringify(payload.schema);
    expect(testCustomForm(payload.schema, answers)).toEqual({ valid: true, checked: 5, errors: [], score: null });
    expect(testCustomForm(payload.schema, {})).toMatchObject({ valid: false, errors: ["內容：尚未填寫", "次數：尚未填寫", "確認：尚未填寫"], score: null });
    expect(JSON.stringify(payload.schema)).toBe(before);
  });
  it.each([{ count: "0" }, { count: Infinity }, { count: 6 }, { confirmed: "false" }, { day: "2025-02-29" }, { choice: "丙" }, { unknown: "不能靜默忽略" }, { note: " " }])("rejects invalid test answer %j", (override) => {
    expect(testCustomForm(payload.schema, { note: "合成", count: 1, confirmed: false, ...override }).valid).toBe(false);
  });
  it("correlates receipt identity, revision, HTTP replay semantics, and persisted envelope", () => {
    const receipt = { formVersionId: versionId, definitionId, revision: 2, status: "draft", replayed: false };
    const envelope = { requestId: key, status: "ok", errors: [], data: { receipt, persisted: true, demo: false } };
    expect(parseCustomDraftSaveResponse(envelope, { formVersionId: versionId, baseRevision: 1 }, 201)).toEqual(receipt);
    expect(() => parseCustomDraftSaveResponse(envelope, { formVersionId: definitionId, baseRevision: 1 }, 201)).toThrow();
    expect(() => parseCustomDraftSaveResponse(envelope, { formVersionId: versionId, baseRevision: 2 }, 201)).toThrow();
    expect(() => parseCustomDraftSaveResponse(envelope, { formVersionId: versionId, baseRevision: 1 }, 200)).toThrow();
    expect(() => parseCustomDraftSaveResponse({ ...envelope, extra: true }, { formVersionId: versionId, baseRevision: 1 }, 201)).toThrow();
  });
});
