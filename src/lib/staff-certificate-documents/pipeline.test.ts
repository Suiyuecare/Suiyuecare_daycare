import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const configuration = vi.hoisted(() => ({ scanner: vi.fn() }));
vi.mock("@/lib/client-documents/pipeline", async () => ({
  ...await vi.importActual<typeof import("@/lib/client-documents/pipeline")>("@/lib/client-documents/pipeline"),
  configuredDocumentScanner: configuration.scanner,
}));
import { configuredStaffCertificateDocumentScanner, processStaffCertificateDocumentUpload, staffDocumentPath, type StaffDocumentPipeline } from "./pipeline";
import { MAX_STAFF_CERTIFICATE_DOCUMENT_BYTES, type StaffCertificateDocumentReceipt, type StaffCertificateDocumentReservation } from "./schema";

const id = (suffix: number) => `ab000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const actor = { organizationId: id(1), branchId: id(2), userId: id(3) };
const input = { staffMembershipId: id(4), certificateKey: id(5), recordVersionId: id(6), recordContentHash: "a".repeat(64), idempotency_key: id(7) };
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6P8sAAAAASUVORK5CYII=", "base64");
const hash = createHash("sha256").update(bytes).digest("hex");
const base: StaffCertificateDocumentReceipt = { documentId: id(8), organizationId: actor.organizationId,
  branchId: actor.branchId, staffMembershipId: input.staffMembershipId, staffUserId: id(9),
  certificateKey: input.certificateKey, recordVersionId: input.recordVersionId, recordContentHash: input.recordContentHash,
  sha256: hash, mimeType: "image/png", fileSizeBytes: bytes.length, uploadedBy: actor.userId,
  uploadedAt: "2026-09-27T12:00:00.123456+00:00", scanStatus: "reserved", persisted: true,
  serviceEligibility: "not_evaluated", signable: false, demo: false };
function fixture(verdict: "clean" | "infected" | "failed" = "clean") {
  const events: string[] = [], store = new Map<string, Uint8Array>();
  const reserve = vi.fn(async (): Promise<StaffCertificateDocumentReservation> => { events.push("reserve_authorized"); return { ...base, objectPath: staffDocumentPath(base), replayed: false, terminalReceipt: null }; });
  const read = vi.fn(async (path: string) => { events.push("reread_stored"); return store.get(path) ?? null; });
  const upload = vi.fn(async (path: string, data: Uint8Array) => { events.push("upload_no_overwrite"); if (store.has(path)) throw new Error("duplicate"); store.set(path, data); });
  const scan = vi.fn(async () => { events.push("scan_stored_bytes"); return verdict; });
  const complete = vi.fn(async () => { events.push("register_server_verdict"); return { ...base, scanStatus: verdict }; });
  const deps: StaffDocumentPipeline = { actor, reserve, storage: { read, upload }, scanner: { name: "synthetic-only", scan }, complete };
  return { deps, events, store, read, upload, scan, complete, reserve };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("staff certificate proof pipeline (synthetic adapters, no external requests)", () => {
  it("requires a separate staff-data purpose approval as well as a configured shared scanner", () => {
    configuration.scanner.mockReturnValue({ name: "synthetic-only" });
    vi.stubEnv("STAFF_CERTIFICATE_DOCUMENTS_SCANNER_APPROVED", "false");
    expect(configuredStaffCertificateDocumentScanner()).toBeNull(); expect(configuration.scanner).not.toHaveBeenCalled();
    vi.stubEnv("STAFF_CERTIFICATE_DOCUMENTS_SCANNER_APPROVED", "true");
    expect(configuredStaffCertificateDocumentScanner()).toEqual({ name: "synthetic-only" });
    configuration.scanner.mockReturnValue(null); expect(configuredStaffCertificateDocumentScanner()).toBeNull();
  });
  it("does zero reservation/storage when scanner is absent", async () => {
    const test = fixture(); test.deps.scanner = null;
    await expect(processStaffCertificateDocumentUpload(test.deps, input, bytes, "image/png")).rejects.toMatchObject({ code: "STAFF_DOCUMENT_SCANNER_NOT_CONFIGURED", httpStatus: 503 });
    expect(test.events).toEqual([]);
  });
  it.each([
    [bytes, "application/pdf"], [Buffer.from("<html>private<script></script></html>"), "image/png"],
    [Buffer.from("%PDF-1.4 /JavaScript(secret)"), "application/pdf"], [Buffer.from("%PDF-1.4 broken"), "application/pdf"],
    [new Uint8Array(0), "image/png"], [new Uint8Array(MAX_STAFF_CERTIFICATE_DOCUMENT_BYTES + 1), "image/png"],
  ])("rejects MIME/active/uninspectable/empty/oversize content before reserving %s", async (data, mime) => {
    const test = fixture(); await expect(processStaffCertificateDocumentUpload(test.deps, input, data, mime)).rejects.toThrow(); expect(test.events).toEqual([]);
  });
  it("reserves, stores without overwrite, rereads and scans actual storage bytes before server registration", async () => {
    const test = fixture(), receipt = await processStaffCertificateDocumentUpload(test.deps, input, bytes, "image/png");
    expect(test.events).toEqual(["reserve_authorized", "upload_no_overwrite", "reread_stored", "scan_stored_bytes", "register_server_verdict"]);
    expect(test.reserve).toHaveBeenCalledWith({ ...input, sha256: hash, mimeType: "image/png", fileSizeBytes: bytes.length });
    expect(test.upload).toHaveBeenCalledWith(staffDocumentPath(base), bytes, "image/png");
    expect(test.scan).toHaveBeenCalledWith(test.store.get(staffDocumentPath(base)));
    expect(test.complete).toHaveBeenCalledWith(base.documentId, hash, "clean", "synthetic-only");
    expect(receipt).toMatchObject({ scanStatus: "clean", signable: false, serviceEligibility: "not_evaluated" });
    expect(receipt).not.toHaveProperty("verified");
  });
  it.each(["infected", "failed"] as const)("quarantines %s without qualification or human-review claims", async verdict => {
    const test = fixture(verdict); expect(await processStaffCertificateDocumentUpload(test.deps, input, bytes, "image/png")).toMatchObject({ scanStatus: verdict, signable: false });
  });
  it("scanner failure becomes failed, never clean", async () => {
    const test = fixture("failed"); test.scan.mockRejectedValue(new Error("private provider diagnostic"));
    expect(await processStaffCertificateDocumentUpload(test.deps, input, bytes, "image/png")).toMatchObject({ scanStatus: "failed" });
  });
  it.each(["organizationId", "branchId", "staffMembershipId", "certificateKey", "recordVersionId", "uploadedBy", "recordContentHash", "sha256", "mimeType", "fileSizeBytes"] as const)("rejects divergent reservation %s before storage", async field => {
    const test = fixture(); const corrupt = { ...base, [field]: field === "fileSizeBytes" ? bytes.length + 1 : field.endsWith("Hash") || field === "sha256" ? "b".repeat(64) : field === "mimeType" ? "image/jpeg" : id(50) };
    test.reserve.mockResolvedValue({ ...corrupt, objectPath: staffDocumentPath(corrupt), replayed: false, terminalReceipt: null });
    await expect(processStaffCertificateDocumentUpload(test.deps, input, bytes, "image/png")).rejects.toMatchObject({ code: "STAFF_DOCUMENT_RESERVATION_UNCERTAIN" });
    expect(test.upload).not.toHaveBeenCalled(); expect(test.scan).not.toHaveBeenCalled();
  });
  it("rejects exact suffix with an incorrect prefix or extra server claims", async () => {
    const test = fixture(); test.reserve.mockResolvedValue({ ...base, objectPath: `${id(55)}/${base.documentId}`, replayed: false, terminalReceipt: null });
    await expect(processStaffCertificateDocumentUpload(test.deps, input, bytes, "image/png")).rejects.toThrow(); expect(test.upload).not.toHaveBeenCalled();
  });
  it("rejects missing/mismatched storage before scanning or completing", async () => {
    const test = fixture(); test.read.mockResolvedValue(Buffer.from("altered"));
    await expect(processStaffCertificateDocumentUpload(test.deps, input, bytes, "image/png")).rejects.toMatchObject({ code: "STAFF_DOCUMENT_STORAGE_MISMATCH" });
    expect(test.scan).not.toHaveBeenCalled(); expect(test.complete).not.toHaveBeenCalled();
  });
  it("an uncertain reserved replay reads the existing object and never overwrites it", async () => {
    const test = fixture(); test.store.set(staffDocumentPath(base), bytes);
    test.reserve.mockResolvedValue({ ...base, objectPath: staffDocumentPath(base), replayed: true, terminalReceipt: null });
    await processStaffCertificateDocumentUpload(test.deps, input, bytes, "image/png"); expect(test.upload).not.toHaveBeenCalled(); expect(test.scan).toHaveBeenCalledTimes(1);
  });
  it("terminal replay preserves the immutable verdict and reauthorizes after storage waits", async () => {
    const test = fixture("failed"), terminal = { ...base, scanStatus: "failed" as const };
    test.store.set(staffDocumentPath(base), bytes);
    test.reserve.mockResolvedValue({ ...terminal, objectPath: staffDocumentPath(base), replayed: true, terminalReceipt: terminal });
    expect(await processStaffCertificateDocumentUpload(test.deps, input, bytes, "image/png")).toEqual(terminal);
    expect(test.events).toEqual(["reread_stored"]); expect(test.reserve).toHaveBeenCalledTimes(2);
    expect(test.upload).not.toHaveBeenCalled(); expect(test.scan).not.toHaveBeenCalled(); expect(test.complete).not.toHaveBeenCalled();
  });
  it("a missing completed blob cannot be recreated under old clean evidence", async () => {
    const test = fixture(), terminal = { ...base, scanStatus: "clean" as const };
    test.reserve.mockResolvedValue({ ...terminal, objectPath: staffDocumentPath(base), replayed: true, terminalReceipt: terminal });
    await expect(processStaffCertificateDocumentUpload(test.deps, input, bytes, "image/png")).rejects.toMatchObject({ code: "STAFF_DOCUMENT_STORAGE_MISMATCH" });
    expect(test.upload).not.toHaveBeenCalled(); expect(test.scan).not.toHaveBeenCalled(); expect(test.complete).not.toHaveBeenCalled();
  });
  it("does not return terminal proof if authority/target/version changes during storage wait", async () => {
    const test = fixture(), terminal = { ...base, scanStatus: "clean" as const };
    test.store.set(staffDocumentPath(base), bytes);
    test.reserve.mockResolvedValueOnce({ ...terminal, objectPath: staffDocumentPath(base), replayed: true, terminalReceipt: terminal }).mockRejectedValueOnce(new Error("authority revoked"));
    await expect(processStaffCertificateDocumentUpload(test.deps, input, bytes, "image/png")).rejects.toThrow("authority revoked"); expect(test.scan).not.toHaveBeenCalled();
  });
  it.each(["documentId", "staffUserId", "uploadedAt", "sha256", "scanStatus", "signable"] as const)("rejects inconsistent completed receipt %s", async field => {
    const test = fixture(); test.complete.mockResolvedValue({ ...base, scanStatus: "clean", [field]: field === "uploadedAt" ? "2026-09-27T12:00:00.123457Z" : field === "sha256" ? "b".repeat(64) : field === "scanStatus" ? "infected" : field === "signable" ? true : id(51) } as never);
    await expect(processStaffCertificateDocumentUpload(test.deps, input, bytes, "image/png")).rejects.toMatchObject({ code: "STAFF_DOCUMENT_RESULT_UNCERTAIN" });
  });
  it("slow reserve becomes unknown and never starts later storage after late completion", async () => {
    vi.useFakeTimers(); const test = fixture(); let finish!: (value: unknown) => void;
    test.deps.reserve = () => new Promise(resolve => { finish = resolve; });
    const pending = processStaffCertificateDocumentUpload(test.deps, input, bytes, "image/png");
    const assertion = expect(pending).rejects.toMatchObject({ code: "STAFF_DOCUMENT_RESULT_UNCERTAIN" });
    await vi.advanceTimersByTimeAsync(20001); await assertion;
    finish({ ...base, objectPath: staffDocumentPath(base), replayed: false, terminalReceipt: null }); await vi.advanceTimersByTimeAsync(1);
    expect(test.upload).not.toHaveBeenCalled(); expect(test.complete).not.toHaveBeenCalled();
  });
  it("hung scanner is bounded to12s and records failed, with no late upgrade to clean", async () => {
    vi.useFakeTimers(); const test = fixture("failed"); let finish!: (value: "clean") => void;
    test.deps.scanner = { name: "synthetic-only", scan: () => new Promise(resolve => { finish = resolve; }) };
    const pending = processStaffCertificateDocumentUpload(test.deps, input, bytes, "image/png");
    await vi.advanceTimersByTimeAsync(12001); const result = await pending;
    expect(result.scanStatus).toBe("failed"); finish("clean"); await vi.advanceTimersByTimeAsync(1);
    expect(test.complete).toHaveBeenCalledTimes(1); expect(test.complete).toHaveBeenCalledWith(base.documentId, hash, "failed", "synthetic-only");
  });
});
