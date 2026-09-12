import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { careRequestHash, synchronizeCareDraft, type CareLocalDraft } from "./care-outbox";

const clientId = "11111111-1111-4111-8111-111111111111";
async function draft(): Promise<CareLocalDraft> {
  const body = { client_id: clientId, page_slug: "staff/daily-care/care-diary", occurred_at: "2026-09-12T01:00:00.000Z",
    data: { shift: "morning", care_item: "活動", note: "合成觀察", abnormal: false } };
  return { id: "22222222-2222-4222-8222-222222222222", clientRef: clientId, kind: "care-note", baseVersion: 0,
    createdAt: "2026-09-12T01:00:00.000Z", expiresAt: "2026-09-13T01:00:00.000Z",
    payload: { schema: 1, serviceDate: "2026-09-12", formValues: { client_id: clientId }, state: "queued",
      request: { body, hash: await careRequestHash(body) } } };
}
function receipt(demo = false, replayed = false) {
  return { requestId: "request-safe", status: "ok", errors: [], data: { demo, persisted: !demo, replayed,
    record: { id: "record-safe", version: 1, status: "draft" }, page: { slug: "staff/daily-care/care-diary" } } };
}
describe("offline care commands", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-12T02:00:00Z")); });
  afterEach(() => vi.useRealTimers());
  it("sends an explicit queued command with the original key and verifies its receipt", async () => {
    const item = await draft(); const send = vi.fn().mockResolvedValue(Response.json(receipt(), { status: 201 }));
    expect(await synchronizeCareDraft(item, send)).toMatchObject({ status: "saved" });
    expect(send).toHaveBeenCalledWith("/api/records", expect.objectContaining({
      headers: { "Content-Type": "application/json", "Idempotency-Key": item.id }, body: JSON.stringify(item.payload.request!.body),
    }));
  });
  it("accepts only verified replay receipts", async () => {
    const send = vi.fn().mockResolvedValue(Response.json(receipt(false, true), { status: 200 }));
    expect(await synchronizeCareDraft(await draft(), send)).toMatchObject({ status: "saved" });
  });
  it.each(["local", "review"] as const)("never sends %s drafts automatically", async (state) => {
    const item = await draft(); item.payload.state = state; const send = vi.fn();
    expect(await synchronizeCareDraft(item, send)).toMatchObject({ status: "review" }); expect(send).not.toHaveBeenCalled();
  });
  it.each(["2026-09-12T02:00:00.000Z", "invalid", "2026-09-15T01:00:00.000Z"])("rejects invalid expiry %s", async (expiresAt) => {
    const item = await draft(); item.expiresAt = expiresAt; const send = vi.fn();
    expect(await synchronizeCareDraft(item, send)).toMatchObject({ status: "review" }); expect(send).not.toHaveBeenCalled();
  });
  it("cannot turn a new draft into a signature or update via offline data", async () => {
    const item = await draft(); item.payload.request!.body.action = "sign";
    item.payload.request!.hash = await careRequestHash(item.payload.request!.body); const send = vi.fn();
    expect(await synchronizeCareDraft(item, send)).toMatchObject({ status: "review" }); expect(send).not.toHaveBeenCalled();
    delete item.payload.request!.body.action; item.baseVersion = 2;
    expect(await synchronizeCareDraft(item, send)).toMatchObject({ status: "review" }); expect(send).not.toHaveBeenCalled();
  });
  it("rejects changed client, changed payload and unsupported page", async () => {
    const item = await draft(); item.payload.request!.body.data = { note: "changed" }; const send = vi.fn();
    expect(await synchronizeCareDraft(item, send)).toMatchObject({ status: "review" });
    item.payload.request!.body.client_id = "33333333-3333-4333-8333-333333333333";
    expect(await synchronizeCareDraft(item, send)).toMatchObject({ status: "review" });
    item.payload.request!.body.page_slug = "staff/daily-care/medication";
    expect(await synchronizeCareDraft(item, send)).toMatchObject({ status: "review" }); expect(send).not.toHaveBeenCalled();
  });
  it.each([401, 403, 409, 422])("retains %s failures for manual review", async (status) => {
    const send = vi.fn().mockResolvedValue(Response.json({}, { status }));
    expect(await synchronizeCareDraft(await draft(), send)).toMatchObject({ status: "review" });
  });
  it("does not mark timeout, malformed or synthetic responses as saved", async () => {
    const item = await draft();
    for (const send of [vi.fn().mockRejectedValue(new Error("secret-exception")), vi.fn().mockResolvedValue(Response.json({ status: "ok" })),
      vi.fn().mockResolvedValue(Response.json(receipt(true), { status: 200 }))]) {
      const result = await synchronizeCareDraft(item, send);
      expect(result.status).toBe("retry"); expect(result.message).not.toContain("secret-exception");
    }
  });
});
