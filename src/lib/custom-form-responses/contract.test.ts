import { describe, expect, it } from "vitest";
import { parseResponseReceipt, parseResponseSnapshot, responseInputSchema, validateFormAnswers, type ResponseInput, type ResponseRecord, type ResponseSnapshot } from "./contract";

export const clientId = "d9500000-0000-4000-8000-000000000001";
export const formId = "d9400000-0000-4000-8000-000000000002";
export const actorId = "d8100000-0000-4000-8000-000000000001";
export const formSchema = { builder: "tenant-custom.v1" as const, fields: [
  { key: "note", label: "紀錄", required: true, type: "text" as const, maxLength: 50 },
  { key: "count", label: "數量", required: true, type: "number" as const, minimum: 0, maximum: 5 },
  { key: "yes", label: "已確認", required: true, type: "boolean" as const },
  { key: "date", label: "日期", required: false, type: "date" as const },
  { key: "choice", label: "方式", required: false, type: "select" as const, options: ["甲", "乙"] },
] };
export const input: ResponseInput = { action: "save", formVersionId: formId, previousId: null, baseRevision: null, serviceDate: "2026-09-22", answers: { note: { state: "answered", value: "合成資料" }, count: { state: "answered", value: 0 }, yes: { state: "answered", value: false } }, reason: null };
export const record: ResponseRecord = { id: "d9600000-0000-4000-8000-000000000001", recordKey: "d9600000-0000-4000-8000-000000000002", revision: 1, previousId: null, correctionSourceId: null, clientId, formVersionId: formId, serviceDate: input.serviceDate, status: "draft", schema: formSchema, answers: input.answers!, reason: null, signatureEvidence: null, contentHash: "a".repeat(64), actorId, createdAt: "2026-09-22T06:00:00Z" };
export const snapshot: ResponseSnapshot = { clientId, forms: [{ id: formId, name: "合成機構表單", version: 1, schema: formSchema, effectiveFrom: "2026-09-01", effectiveTo: null }], records: [record], hasMore: false, total: 1, generatedAt: record.createdAt };

describe("custom response contracts", () => {
  it("accepts false/zero and no scoring", () => { expect(validateFormAnswers(formSchema, input.answers!, true)).toEqual([]); expect(responseInputSchema.parse(input)).toEqual(input); });
  it("allows incomplete draft, not signature", () => { expect(validateFormAnswers(formSchema, {}, false)).toEqual([]); expect(validateFormAnswers(formSchema, {}, true)).toHaveLength(3); });
  it("separates missing and not applicable without required bypass", () => {
    expect(validateFormAnswers(formSchema, { ...input.answers!, note: { state: "not_applicable", reason: "原因" } }, true)).toHaveLength(1);
    expect(validateFormAnswers(formSchema, { ...input.answers!, date: { state: "not_applicable", reason: "原因" } }, true)).toEqual([]);
    expect(validateFormAnswers(formSchema, { ...input.answers!, date: { state: "not_applicable", reason: "" } }, false)).toHaveLength(1);
  });
  it.each([['date','2026-02-30'],['count',6],['count','0'],['yes','false'],['note',' '],['choice','丙'],['date','2026-2-01']])("rejects %s invalid value %s", (key, value) => { expect(validateFormAnswers(formSchema, { ...input.answers!, [key]: { state: "answered", value } }, true).length).toBeGreaterThan(0); });
  it("rejects unknown answer and forged scope/schema", () => { expect(validateFormAnswers(formSchema, { ...input.answers!, injected: { state: "missing" } }, false)).toHaveLength(1); expect(responseInputSchema.safeParse({ ...input, organizationId: actorId }).success).toBe(false); expect(responseInputSchema.safeParse({ ...input, schema: {} }).success).toBe(false); });
  it("requires baseline and correct action body", () => { expect(responseInputSchema.safeParse({ ...input, action: "sign" }).success).toBe(false); expect(responseInputSchema.safeParse({ ...input, baseRevision: 1 }).success).toBe(false); });
  it("binds receipt to scope, submitted values and revision", () => {
    expect(parseResponseReceipt({ record, replayed: false }, input, clientId, actorId).record).toEqual(record);
    for (const change of [{ clientId: actorId }, { formVersionId: actorId }, { revision: 2 }, { actorId: clientId }, { answers: {} }, { serviceDate: "2026-09-21" }]) expect(() => parseResponseReceipt({ record: { ...record, ...change }, replayed: false }, input, clientId, actorId)).toThrow();
  });
  it("rejects cross-client, duplicate and incomplete snapshot", () => {
    expect(parseResponseSnapshot(snapshot, clientId)).toEqual(snapshot);
    expect(() => parseResponseSnapshot(snapshot, actorId)).toThrow();
    expect(() => parseResponseSnapshot({ ...snapshot, records: [record, record] }, clientId)).toThrow();
    expect(() => parseResponseSnapshot({ ...snapshot, total: 0 }, clientId)).toThrow();
  });
  it("binds signing to the saved record, schema and answers", () => {
    const signing: ResponseInput = { ...input, action: "sign", previousId: record.id, baseRevision: record.revision, answers: null };
    const signed: ResponseRecord = { ...record, id: actorId, revision: 2, previousId: record.id, status: "signed",
      signatureEvidence: { signerId: actorId, signedAt: record.createdAt, challengeId: clientId, roles: ["nurse"], aal: "aal2", purpose: "本人確認此機構自訂表單填答" } };
    expect(parseResponseReceipt({ record: signed, replayed: false }, signing, clientId, actorId, record, formSchema).record).toEqual(signed);
    for (const change of [{ answers: { ...record.answers, note: { state: "answered", value: "未確認文字" } } },
      { schema: { ...formSchema, fields: formSchema.fields.map((f) => ({ ...f, label: "不同欄位" })) } },
      { recordKey: clientId }, { reason: "不同理由" }, { correctionSourceId: actorId }]) {
      expect(() => parseResponseReceipt({ record: { ...signed, ...change }, replayed: false }, signing, clientId, actorId, record, formSchema)).toThrow();
    }
    expect(() => parseResponseReceipt({ record: signed, replayed: false }, signing, clientId, actorId, { ...record, id: clientId })).toThrow();
  });
  it("preserves the original signed answers when creating an unsigned correction", () => {
    const correcting: ResponseInput = { ...input, action: "correct", previousId: record.id, baseRevision: 1, answers: null, reason: "更正觀察日期" };
    const corrected: ResponseRecord = { ...record, id: actorId, revision: 2, previousId: record.id, correctionSourceId: record.id, reason: correcting.reason };
    expect(parseResponseReceipt({ record: corrected, replayed: false }, correcting, clientId, actorId, record).record).toEqual(corrected);
    expect(() => parseResponseReceipt({ record: { ...corrected, answers: {} }, replayed: false }, correcting, clientId, actorId, record)).toThrow();
  });
});
