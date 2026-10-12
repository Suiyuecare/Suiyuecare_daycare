import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { processClinicalAttachment } from "./pipeline";
const source = { clientId: "d1600000-0000-4000-8000-000000000001", sourceKind: "care_diary" as const, sourceId: "d1700000-0000-4000-8000-000000000001", sourceVersion: 1, label: "合成照片", idempotency_key: "d1800000-0000-4000-8000-000000000001" };
const sourceFields = { clientId: source.clientId, sourceKind: source.sourceKind, sourceId: source.sourceId, sourceVersion: source.sourceVersion };
const org = "d1300000-0000-4000-8000-000000000001", id = "d1900000-0000-4000-8000-000000000001";
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6P8sAAAAASUVORK5CYII=", "base64");
const sha256 = createHash("sha256").update(bytes).digest("hex"), path = `${org}/${source.clientId}/${id}`;
function fixture() {
  const reserve = vi.fn(async () => ({ ...sourceFields, id, sha256, objectPath: path, replayed: false, scanStatus: null }));
  const store = new Map<string, Uint8Array>(); const upload = vi.fn(async (key: string, data: Uint8Array) => { if (store.has(key)) throw new Error("immutable"); store.set(key, data); });
  const scan = vi.fn(async () => "clean" as "clean" | "infected" | "failed");
  const complete = vi.fn(async (attachmentId: string, hash: string, verdict: "clean" | "infected" | "failed") => ({ ...sourceFields, id: attachmentId, scanStatus: verdict, persisted: true }));
  return { deps: { reserve, storage: { upload, read: async (key: string) => store.get(key) ?? null }, scanner: { name: "test-only", scan }, complete }, reserve, upload, scan, complete, store };
}
describe("record-bound clinical attachments", () => {
  it("refuses before reserve when real scanner is not configured", async () => { const test = fixture(); await expect(processClinicalAttachment({ ...test.deps, scanner: null }, source, bytes, "image/png", org)).rejects.toMatchObject({ code: "DOCUMENT_SCANNER_NOT_CONFIGURED" }); expect(test.reserve).not.toHaveBeenCalled(); });
  it("validates content signature and refuses MIME spoofing before reservation", async () => { const test = fixture(); await expect(processClinicalAttachment(test.deps, source, bytes, "application/pdf", org)).rejects.toThrow(); expect(test.reserve).not.toHaveBeenCalled(); });
  it("uploads immutable private object and registers real scanner verdict", async () => { const test = fixture(); await expect(processClinicalAttachment(test.deps, source, bytes, "image/png", org)).resolves.toMatchObject({ id, scanStatus: "clean", persisted: true }); expect(test.upload).toHaveBeenCalledWith(path, bytes, "image/png"); expect(test.complete).toHaveBeenCalledWith(id, sha256, "clean", "test-only"); });
  it.each(["clientId", "sourceId", "sourceKind", "sourceVersion"] as const)("denies mismatched %s reservation before file write", async field => { const test = fixture(); test.reserve.mockImplementationOnce(async () => ({ ...sourceFields, [field]: field === "sourceVersion" ? 2 : field === "sourceKind" ? "body_assessment" : "d2600000-0000-4000-8000-000000000001", id, sha256, objectPath: path, replayed: false, scanStatus: null } as never)); await expect(processClinicalAttachment(test.deps, source, bytes, "image/png", org)).rejects.toMatchObject({ code: "ATTACHMENT_RESERVATION_UNCERTAIN" }); expect(test.upload).not.toHaveBeenCalled(); });
  it("retries exact key without rescan or duplicate even after scanner configuration changes", async () => { const test = fixture(); await processClinicalAttachment(test.deps, source, bytes, "image/png", org); test.reserve.mockResolvedValue({ ...sourceFields, id, sha256, objectPath: path, replayed: true, scanStatus: "clean" } as never); test.deps.scanner.name = "changed-scanner"; await processClinicalAttachment(test.deps, source, bytes, "image/png", org); expect(test.upload).toHaveBeenCalledTimes(1); expect(test.scan).toHaveBeenCalledTimes(1); expect(test.complete).toHaveBeenCalledTimes(1); });
  it("rejects replay if stored bytes disagree with immutable hash", async () => { const test = fixture(); test.reserve.mockResolvedValue({ ...sourceFields, id, sha256, objectPath: path, replayed: true, scanStatus: null }); test.store.set(path, new Uint8Array([1, 2])); await expect(processClinicalAttachment(test.deps, source, bytes, "image/png", org)).rejects.toMatchObject({ code: "ATTACHMENT_HASH_MISMATCH" }); });
  it("scanner timeout remains failed, never clean", async () => { const test = fixture(); test.scan.mockRejectedValueOnce(new Error("timeout")); await expect(processClinicalAttachment(test.deps, source, bytes, "image/png", org)).resolves.toMatchObject({ scanStatus: "failed" }); });
});
