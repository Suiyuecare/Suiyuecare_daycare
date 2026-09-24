import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { configuredDocumentScanner, inspectDocument, processDocumentUpload, type DocumentPipeline } from "./pipeline";
import { MAX_DOCUMENT_BYTES, documentPermission } from "./schema";
const clientId = "c1600000-0000-4000-8000-000000000001";
const id = "d1600000-0000-4000-8000-000000000001";
const org = "a1600000-0000-4000-8000-000000000001";
const input = { clientId, category: "identity_front" as const, expectedDocumentVersion: 0, idempotency_key: "c1800000-0000-4000-8000-000000000001" };
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6P8sAAAAASUVORK5CYII=", "base64");
function fixture(verdict: "clean" | "infected" | "failed" = "clean") {
  const events: string[] = []; const store = new Map<string, Uint8Array>();
  const reserve = vi.fn(async (metadata) => { events.push("authorized_reserve"); return { id, clientId, category: input.category, version: 1, objectPath: `${org}/${clientId}/${id}`, sha256: metadata.sha256, replayed: false }; });
  const upload = vi.fn(async (path, data) => { events.push("private_no_overwrite_upload"); if (store.has(path)) throw new Error("no upsert"); store.set(path, data); });
  const complete = vi.fn(async () => { events.push("server_scan_registration"); return { id, clientId, category: input.category, version: 1, scanStatus: verdict, persisted: true }; });
  const deps: DocumentPipeline = { reserve, storage: { upload, read: async (path) => store.get(path) ?? null }, scanner: { name: "synthetic-test-only", scan: async () => { events.push("scanner"); return verdict; } }, complete };
  return { events, deps, reserve, upload, complete, store };
}
afterEach(() => vi.unstubAllEnvs());
describe("private client document pipeline", () => {
  it("fails closed without approved scanner before reservation or storage", async () => {
    const test = fixture(); test.deps.scanner = null;
    await expect(processDocumentUpload(test.deps, input, bytes, "image/png")).rejects.toMatchObject({ code: "DOCUMENT_SCANNER_NOT_CONFIGURED", httpStatus: 503 });
    expect(test.events).toEqual([]);
    vi.stubEnv("CLIENT_DOCUMENTS_SCANNER_APPROVED", "false"); expect(configuredDocumentScanner()).toBeNull();
  });
  it("requires configured approved scanner host, not just a bypass switch", () => {
    vi.stubEnv("CLIENT_DOCUMENTS_SCANNER_APPROVED", "true"); vi.stubEnv("CLIENT_DOCUMENTS_CLAMAV_HOST", ""); expect(configuredDocumentScanner()).toBeNull();
    vi.stubEnv("CLIENT_DOCUMENTS_CLAMAV_HOST", "invalid/path"); expect(configuredDocumentScanner()).toBeNull();
    vi.stubEnv("CLIENT_DOCUMENTS_CLAMAV_HOST", "127.0.0.1"); vi.stubEnv("CLIENT_DOCUMENTS_CLAMAV_PORT", "70000"); expect(configuredDocumentScanner()).toBeNull();
  });
  it("validates bytes and size and blocks raw HTML, MIME spoofing, active PDF", () => {
    expect(inspectDocument(bytes, "image/png")).toBe("image/png");
    expect(() => inspectDocument(bytes, "application/pdf")).toThrow();
    expect(() => inspectDocument(Buffer.from("<script>alert(1)</script>"), "application/pdf")).toThrow();
    expect(() => inspectDocument(Buffer.from("%PDF-1.4 /JavaScript evil"), "application/pdf")).toThrow();
    expect(() => inspectDocument(new Uint8Array(MAX_DOCUMENT_BYTES + 1), "image/png")).toThrow();
  });
  it("performs reserve → real storage adapter → scan → server register, using only server UUID path", async () => {
    const test = fixture(); const result = await processDocumentUpload(test.deps, input, bytes, "image/png");
    expect(test.events).toEqual(["authorized_reserve", "private_no_overwrite_upload", "scanner", "server_scan_registration"]);
    expect(test.reserve.mock.calls[0][0].sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(test.upload.mock.calls[0][0]).toBe(`${org}/${clientId}/${id}`);
    expect(result.scanStatus).toBe("clean"); expect(result.persisted).toBe(true);
  });
  it.each(["infected", "failed"] as const)("records quarantine %s without pretending clean or reviewed", async (verdict) => {
    const test = fixture(verdict); const result = await processDocumentUpload(test.deps, input, bytes, "image/png");
    expect(result.scanStatus).toBe(verdict); expect(result).not.toHaveProperty("reviewed");
  });
  it("refuses storage on wrong-client reservation and unauthorized reserve", async () => {
    const test = fixture(); test.reserve.mockImplementationOnce(async () => { throw new Error("outside scope"); });
    await expect(processDocumentUpload(test.deps, input, bytes, "image/png")).rejects.toThrow("outside scope"); expect(test.upload).not.toHaveBeenCalled();
    test.reserve.mockImplementationOnce(async (metadata) => ({ id, clientId: "c2600000-0000-4000-8000-000000000001", category: input.category, version: 1, objectPath: `${org}/${clientId}/${id}`, sha256: metadata.sha256, replayed: false }));
    await expect(processDocumentUpload(test.deps, input, bytes, "image/png")).rejects.toMatchObject({ code: "DOCUMENT_RESERVATION_UNCERTAIN" }); expect(test.upload).not.toHaveBeenCalled();
  });
  it("replay verifies exact blob hash and never upserts", async () => {
    const test = fixture(); const hash = createHash("sha256").update(bytes).digest("hex");
    await processDocumentUpload(test.deps, input, bytes, "image/png");
    test.reserve.mockResolvedValue({ id, clientId, category: input.category, version: 1, objectPath: `${org}/${clientId}/${id}`, sha256: hash, replayed: true });
    await processDocumentUpload(test.deps, input, bytes, "image/png"); expect(test.upload).toHaveBeenCalledTimes(1);
    test.store.set(`${org}/${clientId}/${id}`, Buffer.from("wrong-content"));
    await expect(processDocumentUpload(test.deps, input, bytes, "image/png")).rejects.toMatchObject({ code: "DOCUMENT_STORAGE_MISMATCH" });
  });
  it("maps identity, medication, and health to distinct permissions", () => {
    expect(documentPermission("identity_front")).toBe("clients.manage"); expect(documentPermission("medication_history")).toBe("medications.read"); expect(documentPermission("medication_plan", true)).toBe("medications.manage"); expect(documentPermission("health_exam", true)).toBe("health.write");
  });
  it("returns terminal receipt after uncertain delivery even if scanner outcome later changes", async () => {
    const test = fixture("failed"); const hash = createHash("sha256").update(bytes).digest("hex");
    const terminalReceipt = await processDocumentUpload(test.deps, input, bytes, "image/png");
    test.reserve.mockResolvedValue({ id, clientId, category: input.category, version: 1, objectPath: `${org}/${clientId}/${id}`, sha256: hash, replayed: true, terminalReceipt } as never);
    const scan = vi.fn(async () => "clean" as const); test.deps.scanner = { name: "scanner-now-recovered", scan };
    await expect(processDocumentUpload(test.deps, input, bytes, "image/png")).resolves.toEqual(terminalReceipt);
    expect(scan).not.toHaveBeenCalled(); expect(test.complete).toHaveBeenCalledTimes(1); expect(test.upload).toHaveBeenCalledTimes(1);
  });
});
