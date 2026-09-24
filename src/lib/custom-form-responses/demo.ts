import { parseResponseSnapshot, type ResponseSnapshot } from "./contract";

export const demoFormClient = { id: "a1111111-1111-4111-8111-111111111111", label: "DEMO-001・展示個案（合成資料）" };

/** Read-only synthetic preview. Never used as a failed-production fallback. */
export function buildDemoFormResponses(today: string): ResponseSnapshot {
  const form: ResponseSnapshot["forms"][number] = {
      id: "f1111111-1111-4111-8111-111111111111", name: "機構服務確認單（展示）", version: 1,
      effectiveFrom: "2026-01-01", effectiveTo: null,
      schema: { builder: "tenant-custom.v1", fields: [
        { key: "note", label: "本次服務重點", type: "text", required: true, maxLength: 1000 },
        { key: "count", label: "參與次數", type: "number", required: true, minimum: 0, maximum: 10 },
        { key: "confirmed", label: "是否已完成交班", type: "boolean", required: true },
        { key: "follow_up", label: "下次確認日期", type: "date", required: false },
        { key: "mode", label: "聯絡方式", type: "select", required: false, options: ["當面", "電話", "系統訊息"] },
      ] },
  };
  return parseResponseSnapshot({
    clientId: demoFormClient.id, forms: [form],
    records: [{
      id: "f2222222-2222-4222-8222-222222222222", recordKey: "f3333333-3333-4333-8333-333333333333",
      revision: 1, previousId: null, correctionSourceId: null, clientId: demoFormClient.id,
      formVersionId: form.id, serviceDate: today, status: "draft", schema: form.schema,
      answers: { note: { state: "answered", value: "合成展示：確認今日服務安排與交班事項。" }, count: { state: "answered", value: 0 }, confirmed: { state: "answered", value: false }, follow_up: { state: "answered", value: today }, mode: { state: "not_applicable", reason: "合成展示，未聯絡真人。" } },
      reason: null, signatureEvidence: null, contentHash: "0".repeat(64),
      actorId: "f4444444-4444-4444-8444-444444444444", createdAt: `${today}T00:00:00+08:00`,
    }], hasMore: false, total: 1, generatedAt: `${today}T00:00:00+08:00`,
  }, demoFormClient.id);
}
