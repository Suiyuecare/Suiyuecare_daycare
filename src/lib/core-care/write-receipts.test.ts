import { describe, expect, it } from "vitest";
import { CoreCareReceiptError, parseDiaryWriteReceipt, parseVitalWriteReceipt } from "./write-receipts";

const vitalData = { recordCount: 2, measurementKinds: ["pulse", "temperature"] };
const diaryData = { record: { id: "synthetic-draft", version: 1, status: "draft" }, page: { slug: "staff/daily-care/care-diary" } };
function envelope(data: object, demo = false, replayed = false) {
  return { requestId: "synthetic-request", status: "ok", errors: [], data: { ...data, demo, persisted: !demo, replayed } };
}
describe("dedicated care write receipt boundaries", () => {
  it.each([false, true])("accepts the actual demo=%s envelope and record shape", (demo) => {
    expect(parseVitalWriteReceipt(envelope(vitalData, demo), demo ? 200 : 201, demo, { pulse: 75, temperature: 36.5 }).recordCount).toBe(2);
    expect(parseDiaryWriteReceipt(envelope(diaryData, demo), demo ? 200 : 201, demo).record.status).toBe("draft");
  });
  it("accepts persisted replay and checks blood pressure mapping without relying on order", () => {
    expect(parseVitalWriteReceipt(envelope({ recordCount: 2, measurementKinds: ["blood_pressure_diastolic", "blood_pressure_systolic"] }, false, true), 200, false, { systolic: 120, diastolic: 80 }).recordCount).toBe(2);
    expect(parseDiaryWriteReceipt(envelope(diaryData, false, true), 200, false).record.version).toBe(1);
  });
  it.each([null, {}, { status: "ok" }, { ...envelope(diaryData), errors: ["failed"] }, { ...envelope(diaryData), requestId: " " }, { ...envelope(diaryData), status: "partial" }])("rejects incomplete or non-success envelopes", (raw) => {
    expect(() => parseDiaryWriteReceipt(raw, 201, false)).toThrow(CoreCareReceiptError);
    expect(() => parseVitalWriteReceipt(raw, 201, false, { pulse: 75 })).toThrow(CoreCareReceiptError);
  });
  it.each([
    { demo: true, persisted: false, replayed: false },
    { demo: false, persisted: false, replayed: false },
    { demo: false, persisted: true, replayed: "false" },
  ])("rejects a different environment or inconsistent persistence", (flags) => {
    const raw = { ...envelope(diaryData), data: { ...diaryData, ...flags } };
    expect(() => parseDiaryWriteReceipt(raw, 201, false)).toThrow(CoreCareReceiptError);
  });
  it("does not accept a replay claim in non-persistent demo or a wrong HTTP status", () => {
    expect(() => parseDiaryWriteReceipt(envelope(diaryData, true, true), 200, true)).toThrow(CoreCareReceiptError);
    expect(() => parseDiaryWriteReceipt(envelope(diaryData), 200, false)).toThrow(CoreCareReceiptError);
  });
  it.each([
    { recordCount: 0, measurementKinds: [] },
    { recordCount: 1, measurementKinds: ["pulse", "temperature"] },
    { recordCount: 2.5, measurementKinds: ["pulse", "temperature"] },
    { recordCount: 2, measurementKinds: ["pulse", "pulse"] },
    { recordCount: 2, measurementKinds: ["pulse", "oxygen_saturation"] },
    { recordCount: 2, measurementKinds: ["pulse"] },
  ])("rejects incomplete, duplicate or unrelated measurement results", (data) => {
    expect(() => parseVitalWriteReceipt(envelope(data), 201, false, { pulse: 75, temperature: 36.5 })).toThrow(CoreCareReceiptError);
  });
  it.each([
    { ...diaryData, record: { ...diaryData.record, id: " " } },
    { ...diaryData, record: { ...diaryData.record, version: 0 } },
    { ...diaryData, record: { ...diaryData.record, version: 1.5 } },
    { ...diaryData, record: { ...diaryData.record, status: "signed" } },
    { ...diaryData, page: { slug: "another-page" } },
  ])("rejects an invalid draft receipt instead of marking a draft or signature complete", (data) => {
    expect(() => parseDiaryWriteReceipt(envelope(data), 201, false)).toThrow(CoreCareReceiptError);
  });
});
