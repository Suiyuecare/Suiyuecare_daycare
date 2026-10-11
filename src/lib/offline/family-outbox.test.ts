import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isFamilyMessageDraft, queueFamilyMessage, synchronizeFamilyMessage, type FamilyMessageDraft } from "./family-outbox";
const namespace = { organizationId: "e9100000-0000-4000-8000-000000000001", branchId: "e9200000-0000-4000-8000-000000000001", userId: "e9000000-0000-4000-8000-000000000002" };
const local: FamilyMessageDraft = { id: "e9700000-0000-4000-8000-000000000001", kind: "family-message", clientRef: "e9300000-0000-4000-8000-000000000001", baseVersion: 3, createdAt: "2026-10-12T01:00:00Z", expiresAt: "2026-10-13T01:00:00Z", payload: { schema: 1, body: "合成訊息", state: "local" } };
const receipt = (status = "saved", replayed = false) => ({ data: { receipt: { id: local.id, replayed, status } } });
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T02:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("persistent family message commands", () => {
  it("freezes exact client, thread baseline, content and key before sync", async () => {
    const draft = await queueFamilyMessage(local); const send = vi.fn().mockResolvedValue(Response.json(receipt()));
    expect(await synchronizeFamilyMessage(draft, namespace, send)).toMatchObject({ status: "saved" });
    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ action: "message", clientId: local.clientRef, expectedVersion: 3, body: local.payload.body, idempotency_key: local.id });
    expect(send.mock.calls[0][1].headers).toMatchObject({ "x-care-user": namespace.userId, "x-care-branch": namespace.branchId });
  });
  it("response-loss retry keeps the identical request and accepts verified replay", async () => {
    const draft = await queueFamilyMessage(local); const send = vi.fn().mockRejectedValueOnce(new Error("private detail")).mockResolvedValue(Response.json(receipt("saved", true)));
    expect(await synchronizeFamilyMessage(draft, namespace, send)).toMatchObject({ status: "retry" });
    expect(await synchronizeFamilyMessage(draft, namespace, send)).toMatchObject({ status: "saved" });
    expect(send.mock.calls[0][1].body).toBe(send.mock.calls[1][1].body);
  });
  it("stale base persists a server conflict receipt, never reports sent", async () => {
    expect(await synchronizeFamilyMessage(await queueFamilyMessage(local), namespace, vi.fn().mockResolvedValue(Response.json(receipt("conflict"), { status: 409 })))).toMatchObject({ status: "review" });
  });
  it.each([401, 403])("stops synchronization on revoked admission %s", async status => {
    expect(await synchronizeFamilyMessage(await queueFamilyMessage(local), namespace, vi.fn().mockResolvedValue(Response.json({}, { status })))).toMatchObject({ status: "revoked" });
  });
  it.each(["local", "review"] as const)("never automatically sends %s draft", async state => { const send = vi.fn(); expect(await synchronizeFamilyMessage({ ...local, payload: { ...local.payload, state } }, namespace, send)).toMatchObject({ status: "review" }); expect(send).not.toHaveBeenCalled(); });
  it("rejects altered body, different client/key/baseline, files and unsigned hashes", async () => {
    const queued = await queueFamilyMessage(local); const send = vi.fn();
    for (const draft of [{ ...queued, clientRef: namespace.userId }, { ...queued, baseVersion: 4 }, { ...queued, payload: { ...queued.payload, body: "changed" } }, { ...queued, payload: { ...queued.payload, file: "not allowed" } }, { ...queued, payload: { ...queued.payload, hash: "0".repeat(64) } }]) { expect(await synchronizeFamilyMessage(draft, namespace, send)).toMatchObject({ status: "review" }); }
    expect(send).not.toHaveBeenCalled(); expect(isFamilyMessageDraft({ ...queued, kind: "care-note" })).toBe(false);
  });
  it("does not extend expiry and refuses expired or future-created commands", async () => { const queued = await queueFamilyMessage(local); const send = vi.fn(); for (const draft of [{ ...queued, expiresAt: "2026-10-12T01:59:00Z" }, { ...queued, expiresAt: "2026-10-14T01:00:00Z" }, { ...queued, createdAt: "2026-10-12T03:00:00Z" }]) expect(await synchronizeFamilyMessage(draft, namespace, send)).toMatchObject({ status: "review" }); expect(send).not.toHaveBeenCalled(); });
  it("malformed and generic success do not clear pending draft", async () => { for (const body of [{ data: { receipt: { id: local.id, replayed: false } } }, { data: { persisted: true } }]) expect(await synchronizeFamilyMessage(await queueFamilyMessage(local), namespace, vi.fn().mockResolvedValue(Response.json(body)))).toMatchObject({ status: "retry" }); });
});
