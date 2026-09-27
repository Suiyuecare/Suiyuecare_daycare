import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ImportError } from "./errors";
import { parseCentralCareHtml } from "./parser";
import { readTrustedUploadRecovery, recoverTrustedHtmlImport, type TrustedRecoveryDependencies } from "./trusted-recovery";
import { trustedUploadOperationId, type StagingRpcClient } from "./trusted-staging";
import { CURRENT_MAPPING_VERSION, type HtmlImportFile, type ImportActor } from "./types";
import { validateHtmlImportFile } from "./validation";

const uuid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-09-28T00:00:00Z");
const secret = "SYNTHETIC_PROVIDER_TOKEN_MUST_NOT_ESCAPE";
const actor: ImportActor = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3), assuranceLevel: "aal2", recentAal2At: now.toISOString() };
const input = { reservationId: uuid(4), originalOperationKey: "original browser key", recoveryOperationKey: uuid(5) };
function harness(mode: "general" | "routine-intake" = "general") {
  const current: ImportActor = mode === "general" ? { ...actor } : { ...actor, assuranceLevel: "aal1", recentAal2At: null };
  const file: HtmlImportFile = { fileName: "synthetic.html", mimeType: "text/html", bytes: new TextEncoder().encode(
    '<!doctype html><html><body><h5>需要服務者基本資料</h5><table><tr><th>個案姓名</th><td>完全合成測試個案</td></tr></table><script>fetch("https://malicious.invalid/")</script></body></html>') };
  const validated = validateHtmlImportFile(file), parsed = parseCentralCareHtml(validated, CURRENT_MAPPING_VERSION);
  const created_at = "2026-09-01T00:00:00.000001Z";
  const receipt = { reservation_id: input.reservationId, status: "completed", staging_only: true, formally_imported: false,
    file_sha256: validated.sha256, content_fingerprint: parsed.contentFingerprint, mapping_version: parsed.mappingVersion,
    payload_sha256: createHash("sha256").update(JSON.stringify(parsed)).digest("hex"), section_count: parsed.sections.length,
    field_count: parsed.fields.length, completed_at: "2026-09-28T00:00:00Z", replayed: false };
  const envelope = { schema_version: 1, recovery_id: uuid(6), recovery_operation_id: input.recoveryOperationKey,
    original_operation_id: trustedUploadOperationId(current, input.originalOperationKey), reservation_id: input.reservationId,
    organization_id: current.organizationId, branch_id: current.branchId, actor_user_id: current.userId, mode,
    file_sha256: validated.sha256, file_name: validated.fileName, mime_type: validated.mimeType, file_size_bytes: file.bytes.byteLength,
    mapping_version: parsed.mappingVersion, created_at, recovery_created_at: now.toISOString(), expires_at: "2026-09-28T00:15:00Z",
    status: "queued", receipt: null as unknown, replayed: false, staging_only: true, formally_imported: false };
  const archiveReference = { key: `organizations/${actor.organizationId}/branches/${actor.branchId}/central-html/${validated.sha256}/${input.reservationId}.html`,
    versionId: "synthetic-original-version", createdAt: new Date(created_at).toISOString(), retainUntil: "2033-09-01T00:00:00.001Z", sha256: validated.sha256, byteLength: file.bytes.byteLength };
  const order: string[] = [];
  const user = vi.fn<StagingRpcClient["rpc"]>(async () => { order.push("reserve"); return { data: structuredClone(envelope), error: null }; });
  const worker = vi.fn<StagingRpcClient["rpc"]>(async () => { order.push("complete"); return { data: structuredClone(receipt), error: null }; });
  const archive = vi.fn<TrustedRecoveryDependencies["archive"]["archive"]>(async () => { order.push("archive"); return structuredClone(archiveReference); });
  const reauthorize = vi.fn<TrustedRecoveryDependencies["reauthorize"]>(async () => { order.push("auth"); return { ...current }; });
  const dependencies: TrustedRecoveryDependencies = { userClient: { rpc: user }, workerClient: { rpc: worker }, archive: { archive }, reauthorize };
  return { current, mode, file, parsed, validated, receipt, envelope, archiveReference, order, user, worker, archive, reauthorize, dependencies };
}
async function safeError(operation: Promise<unknown>, code: string) {
  const error: unknown = await operation.catch(value => value);
  expect(error).toBeInstanceOf(ImportError); expect(error).toHaveProperty("code", code);
  expect(String(error)).not.toContain(secret); expect(JSON.stringify(error)).not.toContain(secret); expect(error).not.toHaveProperty("cause");
  return error;
}
const recover = (test: ReturnType<typeof harness>, overrides = input) => recoverTrustedHtmlImport(test.dependencies, test.current, test.file, overrides, test.mode);
describe("trusted original reservation recovery", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it.each(["general", "routine-intake"] as const)("uses fresh %s authority but original source bytes/time/path", async mode => {
    const test = harness(mode); expect(await recover(test)).toEqual(test.receipt);
    expect(test.order).toEqual(["auth", "reserve", "auth", "auth", "archive", "auth", "auth", "complete", "auth"]);
    expect(test.user).toHaveBeenCalledExactlyOnceWith("reserve_import_upload_recovery", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_reservation: input.reservationId,
      p_original_operation: trustedUploadOperationId(actor, input.originalOperationKey), p_recovery_operation: input.recoveryOperationKey,
      p_file_sha256: test.validated.sha256, p_file_name: test.validated.fileName, p_mime_type: "text/html",
      p_file_size_bytes: test.file.bytes.byteLength, p_mapping_version: CURRENT_MAPPING_VERSION, p_mode: mode,
    });
    expect(test.archive).toHaveBeenCalledExactlyOnceWith({ organizationId: actor.organizationId, branchId: actor.branchId }, input.reservationId,
      test.file.bytes, test.validated.sha256, new Date(test.envelope.created_at));
    expect(test.worker).toHaveBeenCalledExactlyOnceWith("complete_recovered_import_upload", {
      p_recovery: test.envelope.recovery_id, p_parsed_payload: JSON.stringify(test.parsed), p_archive_reference: test.archiveReference,
    });
    expect(test.current.assuranceLevel).toBe(mode === "general" ? "aal2" : "aal1");
    expect(test.parsed.security.externalRequestCount).toBe(0);
  });
  it("copies original actor, input, bytes and metadata before the first await", async () => {
    const test = harness(); const original = test.file.bytes.slice(); const mutableInput = { ...input };
    test.reauthorize.mockImplementation(async () => {
      test.current.branchId = uuid(9); mutableInput.reservationId = uuid(9); mutableInput.recoveryOperationKey = uuid(9);
      test.file.bytes.fill(0); test.file.fileName = "changed.html"; return { ...actor };
    });
    expect(await recover(test, mutableInput)).toEqual(test.receipt);
    expect(test.user.mock.calls[0]![1]).toMatchObject({ p_reservation: input.reservationId, p_recovery_operation: input.recoveryOperationKey, p_file_name: "synthetic.html" });
    expect(test.archive.mock.calls[0]![2]).toEqual(original);
  });
  it("normalizes MIME exactly as the actual parser and reserve contract", async () => {
    const test = harness(); test.file.mimeType = "TEXT/HTML; charset=UTF-8"; await recover(test);
    expect(test.user.mock.calls[0]![1]).toHaveProperty("p_mime_type", "text/html");
  });
  it("completed reserve returns verified original receipt without another archive or worker write", async () => {
    const test = harness(); test.user.mockResolvedValue({ data: { ...test.envelope, status: "completed", receipt: test.receipt, replayed: true }, error: null });
    expect(await recover(test)).toEqual(test.receipt); expect(test.archive).not.toHaveBeenCalled(); expect(test.worker).not.toHaveBeenCalled();
    expect(test.reauthorize).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["aal1", { assuranceLevel: "aal1", recentAal2At: null }], ["missing", { recentAal2At: null }],
    ["expired", { recentAal2At: "2026-09-27T23:44:59Z" }], ["future microsecond", { recentAal2At: "2026-09-28T00:00:00.000001Z" }],
    ["scope", { branchId: uuid(9) }], ["actor", { userId: uuid(9) }],
  ])("rejects actual current %s proof before reservation", async (_name, change) => {
    const test = harness(); test.reauthorize.mockResolvedValue({ ...actor, ...change } as ImportActor);
    await safeError(recover(test), "IMPORT_RECOVERY_DENIED"); expect(test.user).not.toHaveBeenCalled(); expect(test.archive).not.toHaveBeenCalled();
  });
  it("does not accept fabricated cached recent evidence when true provider denies", async () => {
    const test = harness(); test.reauthorize.mockRejectedValue(new ImportError("SECRET", secret, 403));
    await safeError(recover(test), "IMPORT_RECOVERY_DENIED"); expect(test.order).toEqual([]);
  });
  it.each([1, 2, 3, 4, 5, 6])("stops at reauthorization boundary %s after live revocation", async deniedCall => {
    const test = harness(); let call = 0;
    test.reauthorize.mockImplementation(async () => { if (++call === deniedCall) throw new ImportError("UPSTREAM", secret, 403); return { ...actor }; });
    await safeError(recover(test), "IMPORT_RECOVERY_DENIED");
    expect(test.archive).toHaveBeenCalledTimes(deniedCall <= 3 ? 0 : 1);
    expect(test.worker).toHaveBeenCalledTimes(deniedCall <= 5 ? 0 : 1);
  });
  it.each(["42501", "22023", "23505", "55000", "unknown"])("sanitizes reserve SQL %s without archiving", async code => {
    const test = harness(); test.user.mockResolvedValue({ data: null, error: { code, message: secret } });
    await safeError(recover(test), code === "42501" ? "IMPORT_RECOVERY_DENIED" : code === "unknown" ? "IMPORT_RECOVERY_RESULT_UNKNOWN" : "IMPORT_RECOVERY_CONFLICT");
    expect(test.archive).not.toHaveBeenCalled(); expect(test.worker).not.toHaveBeenCalled();
  });
  it.each([
    { reservation_id: uuid(9) }, { original_operation_id: uuid(9) }, { recovery_operation_id: uuid(9) }, { actor_user_id: uuid(9) },
    { branch_id: uuid(9) }, { organization_id: uuid(9) }, { mode: "routine-intake" }, { file_name: "other.html" },
    { mime_type: "application/xhtml+xml" }, { file_size_bytes: 1 }, { file_sha256: "f".repeat(64) }, { mapping_version: "future@2" },
    { recovery_created_at: "2027-01-01T00:00:00Z", expires_at: "2027-01-01T00:15:00Z" }, { secret },
  ])("rejects reserve binding tamper %j", async change => {
    const test = harness(); test.user.mockResolvedValue({ data: { ...test.envelope, ...change }, error: null });
    await safeError(recover(test), "IMPORT_RECOVERY_INVALID_RESPONSE"); expect(test.archive).not.toHaveBeenCalled();
  });
  it("does not use an observed expired queued attempt as write authorization", async () => {
    const test = harness(); test.user.mockResolvedValue({ data: { ...test.envelope, recovery_created_at: "2026-09-27T23:00:00Z", expires_at: "2026-09-27T23:15:00Z" }, error: null });
    await safeError(recover(test), "IMPORT_RECOVERY_DENIED"); expect(test.archive).not.toHaveBeenCalled();
  });
  it.each([ { key: "other/key" }, { versionId: "null" }, { sha256: "f".repeat(64) }, { byteLength: 1 },
    { createdAt: now.toISOString() }, { retainUntil: "2033-08-31T23:59:59Z" }, { secret } ])("rejects WORM reference tamper %j without completion", async change => {
    const test = harness(); test.archive.mockResolvedValue({ ...test.archiveReference, ...change });
    await safeError(recover(test), "IMPORT_RECOVERY_INVALID_RESPONSE"); expect(test.worker).not.toHaveBeenCalled();
  });
  it.each([ { reservation_id: uuid(9) }, { payload_sha256: "f".repeat(64) }, { content_fingerprint: "f".repeat(64) }, { field_count: 0 },
    { completed_at: "2026-09-01T00:00:00.000000Z" }, { completed_at: "2027-01-01T00:00:00Z" }, { formally_imported: true }, { secret } ])("rejects worker original-receipt tamper %j", async change => {
    const test = harness(); test.worker.mockResolvedValue({ data: { ...test.receipt, ...change }, error: null });
    await safeError(recover(test), "IMPORT_RECOVERY_INVALID_RESPONSE"); expect(test.archive).toHaveBeenCalledTimes(1);
  });
  it("keeps external WORM persistence and unknown result truthful on postarchive worker failure", async () => {
    const test = harness(); test.worker.mockRejectedValue(new Error(secret));
    await safeError(recover(test), "IMPORT_RECOVERY_RESULT_UNKNOWN"); expect(test.archive).toHaveBeenCalledTimes(1);
    expect(test.dependencies.archive).not.toHaveProperty("delete");
  });
  it.each(["auth", "reserve", "archive", "complete"] as const)("bounds uncooperative %s and rejects late revival", async phase => {
    const test = harness(); let resolve!: (value: unknown) => void;
    const held = new Promise<unknown>(done => { resolve = done; });
    if (phase === "auth") test.reauthorize.mockImplementation(() => held as Promise<ImportActor>);
    if (phase === "reserve") test.user.mockImplementation(() => held as ReturnType<StagingRpcClient["rpc"]>);
    if (phase === "archive") test.archive.mockImplementation(() => held as ReturnType<TrustedRecoveryDependencies["archive"]["archive"]>);
    if (phase === "complete") test.worker.mockImplementation(() => held as ReturnType<StagingRpcClient["rpc"]>);
    const pending = safeError(recover(test), "IMPORT_RECOVERY_RESULT_UNKNOWN");
    await vi.advanceTimersByTimeAsync(20_000); await pending;
    resolve(phase === "auth" ? actor : phase === "archive" ? test.archiveReference : { data: phase === "reserve" ? test.envelope : test.receipt, error: null });
    await vi.advanceTimersByTimeAsync(1);
    expect(test.worker).toHaveBeenCalledTimes(phase === "complete" ? 1 : 0);
    expect(test.archive).toHaveBeenCalledTimes(["archive", "complete"].includes(phase) ? 1 : 0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses one total deadline across successful independent awaits", async () => {
    const test = harness(); test.reauthorize.mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 3500)); return { ...actor }; });
    const pending = safeError(recover(test), "IMPORT_RECOVERY_RESULT_UNKNOWN"); await vi.advanceTimersByTimeAsync(20_000); await pending;
    expect(test.worker).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(2000); expect(test.user).toHaveBeenCalledTimes(1);
  });
  it("monotonic check stops a timer-starved late reserve before archive", async () => {
    const test = harness(); const clock = vi.spyOn(performance, "now"); let elapsed = 0; clock.mockImplementation(() => elapsed);
    test.user.mockImplementation(async () => { elapsed = 20_001; return { data: test.envelope, error: null }; });
    await safeError(recover(test), "IMPORT_RECOVERY_RESULT_UNKNOWN"); expect(test.archive).not.toHaveBeenCalled();
  });
  it("owner abort never dispatches or revives the late pending reservation", async () => {
    const test = harness(); const controller = new AbortController(); test.dependencies.signal = controller.signal;
    let resolve!: (value: { data: unknown; error: null }) => void;
    test.user.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = safeError(recover(test), "IMPORT_RECOVERY_RESULT_UNKNOWN"); await vi.advanceTimersByTimeAsync(0); controller.abort(); await pending;
    resolve({ data: test.envelope, error: null }); await vi.advanceTimersByTimeAsync(0); expect(test.archive).not.toHaveBeenCalled();
  });
  it("already aborted owner causes no dependency work", async () => {
    const test = harness(); const controller = new AbortController(); controller.abort(); test.dependencies.signal = controller.signal;
    await safeError(recover(test), "IMPORT_RECOVERY_RESULT_UNKNOWN"); expect(test.reauthorize).not.toHaveBeenCalled();
  });
  it("rejects original/recovery namespace collision before any persistence", async () => {
    const test = harness(); await safeError(recover(test, { ...input, recoveryOperationKey: trustedUploadOperationId(actor, input.originalOperationKey) }), "IMPORT_RECOVERY_INVALID_REQUEST");
    expect(test.order).toEqual([]);
  });
  it("routine remains capped at 4 MiB without acquiring MFA", async () => {
    const test = harness("routine-intake"); test.file.bytes = new Uint8Array(4 * 1024 * 1024 + 1);
    await safeError(recover(test), "IMPORT_RECOVERY_INVALID_FILE"); expect(test.reauthorize).not.toHaveBeenCalled();
  });
  it("read null is purely observational, dispatches one RPC and no recovery write", async () => {
    const test = harness("routine-intake"); test.user.mockResolvedValue({ data: null, error: null });
    expect(await readTrustedUploadRecovery(test.dependencies.userClient, test.current, input.recoveryOperationKey, test.mode)).toBeNull();
    expect(test.user).toHaveBeenCalledExactlyOnceWith("import_upload_recovery_receipt", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_recovery_operation: input.recoveryOperationKey, p_mode: test.mode,
    }); expect(test.archive).not.toHaveBeenCalled(); expect(test.worker).not.toHaveBeenCalled();
  });
  it("historical general read requires AAL2 but not fresh 15-minute evidence", async () => {
    const test = harness(); test.current.recentAal2At = null;
    expect(await readTrustedUploadRecovery(test.dependencies.userClient, test.current, input.recoveryOperationKey, test.mode)).toEqual(test.envelope);
    await safeError(readTrustedUploadRecovery(test.dependencies.userClient, { ...test.current, assuranceLevel: "aal1" }, input.recoveryOperationKey, test.mode), "IMPORT_RECOVERY_DENIED");
  });
  it.each([{ recovery_operation_id: uuid(9) }, { actor_user_id: uuid(9) }, { mode: "routine-intake" }, { replayed: true },
    { status: "completed", receipt: null }, { secret }])("read rejects exact owner/key/mode/proof tamper %j", async change => {
    const test = harness(); test.user.mockResolvedValue({ data: { ...test.envelope, ...change }, error: null });
    await safeError(readTrustedUploadRecovery(test.dependencies.userClient, test.current, input.recoveryOperationKey, test.mode), "IMPORT_RECOVERY_INVALID_RESPONSE");
  });
  it("read refuses mutated completed replay flag but accepts the original exact historical receipt", async () => {
    const test = harness(); test.user.mockResolvedValue({ data: { ...test.envelope, status: "completed", receipt: test.receipt }, error: null });
    expect((await readTrustedUploadRecovery(test.dependencies.userClient, test.current, input.recoveryOperationKey, test.mode))?.receipt).toEqual(test.receipt);
    test.user.mockResolvedValue({ data: { ...test.envelope, status: "completed", receipt: { ...test.receipt, replayed: true } }, error: null });
    await safeError(readTrustedUploadRecovery(test.dependencies.userClient, test.current, input.recoveryOperationKey, test.mode), "IMPORT_RECOVERY_INVALID_RESPONSE");
  });
  it("bounds a stalled read and never interprets timeout as not_found", async () => {
    const test = harness(); test.user.mockImplementation(() => new Promise(() => {}));
    const pending = safeError(readTrustedUploadRecovery(test.dependencies.userClient, test.current, input.recoveryOperationKey, test.mode), "IMPORT_RECOVERY_RESULT_UNKNOWN");
    await vi.advanceTimersByTimeAsync(20_000); await pending; expect(test.user).toHaveBeenCalledTimes(1);
  });
});
