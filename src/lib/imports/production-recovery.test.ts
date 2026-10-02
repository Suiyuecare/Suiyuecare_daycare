import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const recovery = vi.hoisted(() => vi.fn());
vi.mock("./trusted-recovery", () => ({ recoverTrustedHtmlImport: recovery }));
import { ImportError } from "./errors";
import { parseCentralCareHtml } from "./parser";
import { GeneralProductionImportRepository } from "./production-repository";
import { deterministicBatchId } from "./service";
import { trustedUploadOperationId } from "./trusted-staging";
import type { StagingRpcClient } from "./trusted-staging";
import { CURRENT_MAPPING_VERSION, type ImportActor, type ImportBatchRecord } from "./types";
import { validateHtmlImportFile } from "./validation";

const actor: ImportActor = { organizationId: "10000000-0000-4000-8000-000000000001", branchId: "20000000-0000-4000-8000-000000000001",
  userId: "30000000-0000-4000-8000-000000000001", assuranceLevel: "aal2", recentAal2At: null };
const originalKey = "original-general-upload";
const options = { reservationId: "40000000-0000-4000-8000-000000000001", originalOperationKey: originalKey,
  recoveryOperationKey: "50000000-0000-4000-8000-000000000001" };
function fixture() {
  const fresh = { ...actor, recentAal2At: new Date().toISOString() };
  const file = { fileName: "synthetic.html", mimeType: "text/html", bytes: new TextEncoder().encode("<!doctype html><h5>申請資訊</h5><table><tr><th>姓名</th><td>合成資料</td></tr></table>") };
  const validated = validateHtmlImportFile(file); const parsed = parseCentralCareHtml(validated, CURRENT_MAPPING_VERSION);
  const stamp = new Date(Date.now() - 60_000).toISOString(); const retention = new Date(stamp); retention.setUTCFullYear(retention.getUTCFullYear() + 7);
  const batch: ImportBatchRecord = { ...parsed, id: deterministicBatchId(actor, originalKey), organizationId: actor.organizationId,
    branchId: actor.branchId, version: 1, status: parsed.sections.some(value => !value.recognized) || parsed.fields.some(value => value.mappingState === "unknown") ? "mapping_required" : "ready_for_approval",
    fileName: file.fileName, mimeType: file.mimeType, charset: "utf-8", byteLength: file.bytes.byteLength, fileSha256: validated.sha256,
    createdAt: stamp, createdBy: actor.userId, updatedAt: stamp, approval: null, operationKeys: { upload: originalKey },
    originalObjectReference: JSON.stringify({ reservationId: options.reservationId, archive: {
      key: `organizations/${actor.organizationId}/branches/${actor.branchId}/central-html/${validated.sha256}/${options.reservationId}.html`,
      versionId: "synthetic-version", retainUntil: retention.toISOString(), sha256: validated.sha256, createdAt: stamp, byteLength: file.bytes.byteLength } }) };
  let granted = true;
  const reauthorize = vi.fn(async () => {
    if (!granted) throw new ImportError("IMPORT_PERMISSION_DENIED", "目前已撤權。", 403);
    return { ...fresh };
  });
  const rpc = vi.fn<StagingRpcClient["rpc"]>(async () => ({ data: { batch, request: { fileSha256: validated.sha256, fileName: file.fileName, mimeType: file.mimeType }, duplicate: false, replayed: false }, error: null }));
  const archive = { archive: vi.fn(), read: vi.fn() };
  const worker = { rpc: vi.fn() };
  const repository = new GeneralProductionImportRepository({ actor: fresh, permission: "upload", userClient: { rpc }, workerClient: worker, archive, reauthorize });
  const receipt = { reservation_id: options.reservationId, status: "completed", staging_only: true, formally_imported: false,
    file_sha256: validated.sha256, content_fingerprint: parsed.contentFingerprint };
  recovery.mockResolvedValue(receipt);
  return { repository, file, fresh, batch, rpc, archive, worker, receipt, reauthorize, revoke: () => { granted = false; } };
}
beforeEach(() => { vi.resetAllMocks(); });
describe("general recovery attachment boundary", () => {
  it("restores the original batch/key through explicit recovery only", async () => {
    const f = fixture(); const signal = new AbortController().signal;
    const result = await f.repository.recoverQueuedUpload(f.file, options, signal);
    expect(result.batch.id).toBe(deterministicBatchId(actor, originalKey));
    expect(recovery).toHaveBeenCalledWith(expect.objectContaining({ signal }), f.fresh, expect.objectContaining({ fileName: f.file.fileName }), options, "general");
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("general_import_repository_attach", { p_org: actor.organizationId, p_branch: actor.branchId,
      p_batch: f.batch.id, p_reservation: options.reservationId, p_key: originalKey });
    expect(f.worker.rpc).not.toHaveBeenCalled(); expect(f.archive.archive).not.toHaveBeenCalled();
  });
  it("returns the same original version on attachment replay, not a latest fabricated version", async () => {
    const f = fixture(); f.rpc.mockImplementation(async () => ({ data: { batch: f.batch, request: { fileSha256: f.batch.fileSha256, fileName: f.file.fileName, mimeType: f.file.mimeType }, duplicate: false, replayed: true }, error: null }));
    expect(await f.repository.recoverQueuedUpload(f.file, options)).toMatchObject({ replayed: true, batch: { version: 1 } });
  });
  it("captures original intent before authorization waits", async () => {
    const f = fixture(); const captured = { ...options };
    f.reauthorize.mockImplementationOnce(async () => { captured.originalOperationKey = "changed-key"; captured.reservationId = actor.userId; return f.fresh; });
    await f.repository.recoverQueuedUpload(f.file, captured);
    expect(recovery.mock.calls[0]![3]).toEqual(options); expect(f.rpc.mock.calls[0]![1]).toMatchObject({ p_key: originalKey, p_reservation: options.reservationId });
  });
  it("denies before any recovery when authority is revoked", async () => {
    const f = fixture(); f.revoke(); await expect(f.repository.recoverQueuedUpload(f.file, options)).rejects.toMatchObject({ httpStatus: 403 });
    expect(recovery).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("checks current authority again before attaching after a completed stage", async () => {
    const f = fixture(); recovery.mockImplementation(async () => { f.revoke(); return f.receipt; });
    await expect(f.repository.recoverQueuedUpload(f.file, options)).rejects.toMatchObject({ httpStatus: 403 }); expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { reservation_id: actor.userId }, { status: "queued" }, { staging_only: false }, { formally_imported: true },
    { file_sha256: "b".repeat(64) }, { content_fingerprint: "b".repeat(64) },
  ])("rejects mismatched restored source %#", async patch => {
    const f = fixture(); recovery.mockResolvedValue({ ...f.receipt, ...patch });
    await expect(f.repository.recoverQueuedUpload(f.file, options)).rejects.toMatchObject({ httpStatus: 502 }); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("does not treat another duplicate batch as exact original recovery", async () => {
    const f = fixture(); f.rpc.mockImplementation(async () => ({ data: { batch: f.batch, request: { fileSha256: f.batch.fileSha256, fileName: f.file.fileName, mimeType: f.file.mimeType }, duplicate: true, replayed: false }, error: null }));
    await expect(f.repository.recoverQueuedUpload(f.file, options)).rejects.toMatchObject({ httpStatus: 502 });
  });
  it("rejects source attachment conflict without inventing completion", async () => {
    const f = fixture(); f.rpc.mockImplementation(async () => ({ data: null, error: { code: "23505", message: "PRIVATE_SOURCE" } }));
    await expect(f.repository.recoverQueuedUpload(f.file, options)).rejects.toMatchObject({ code: "IMPORT_OPERATION_CONFLICT", httpStatus: 409 });
  });
  it("discards attachment receipt after current permission revocation", async () => {
    const f = fixture(); f.rpc.mockImplementation(async () => { f.revoke(); return { data: { batch: f.batch, request: { fileSha256: f.batch.fileSha256, fileName: f.file.fileName, mimeType: f.file.mimeType }, duplicate: false, replayed: false }, error: null }; });
    await expect(f.repository.recoverQueuedUpload(f.file, options)).rejects.toMatchObject({ httpStatus: 403 });
  });
  it("propagates unknown recovery without calling attachment", async () => {
    const f = fixture(); recovery.mockRejectedValue(new ImportError("IMPORT_RECOVERY_RESULT_UNKNOWN", "原操作結果尚未確認。", 503));
    await expect(f.repository.recoverQueuedUpload(f.file, options)).rejects.toMatchObject({ httpStatus: 503 }); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("keeps actual future MFA denial", async () => {
    const f = fixture(); f.reauthorize.mockResolvedValue({ ...f.fresh, recentAal2At: new Date(Date.now() + 60_000).toISOString() });
    await expect(f.repository.recoverQueuedUpload(f.file, options)).rejects.toMatchObject({ httpStatus: 403 }); expect(recovery).not.toHaveBeenCalled();
  });
  it("does not dispatch attachment if cancelled during its authorization wait", async () => {
    const f = fixture(); const owner = new AbortController();
    f.reauthorize.mockImplementationOnce(async () => f.fresh).mockImplementationOnce(async () => { owner.abort(); return f.fresh; });
    await expect(f.repository.recoverQueuedUpload(f.file, options, owner.signal)).rejects.toMatchObject({ code: "IMPORT_REPOSITORY_RESULT_UNKNOWN", httpStatus: 503 });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("does not disclose an in-flight attachment after cancellation", async () => {
    const f = fixture(); const owner = new AbortController();
    f.rpc.mockImplementation(async () => { owner.abort(); return { data: { batch: f.batch, request: { fileSha256: f.batch.fileSha256, fileName: f.file.fileName, mimeType: f.file.mimeType }, duplicate: false, replayed: false }, error: null }; });
    await expect(f.repository.recoverQueuedUpload(f.file, options, owner.signal)).rejects.toMatchObject({ code: "IMPORT_REPOSITORY_RESULT_UNKNOWN", httpStatus: 503 });
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("uses different trusted original-operation namespace than batch ID", () => {
    expect(trustedUploadOperationId(actor, originalKey)).not.toBe(deterministicBatchId(actor, originalKey));
  });
});
