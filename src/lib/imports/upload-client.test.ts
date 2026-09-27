import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { CmsUploadOperation, CmsUploadScope } from "./upload-pending";
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope: CmsUploadScope = { authority: "test", organizationId: uuid(1), branchId: uuid(2), actorUserId: uuid(3), mode: "routine-intake", clientId: null };
const file = () => new File(["<html>same original bytes</html>"], "synthetic.html", { type: "text/html" });
let client: typeof import("./upload-client");
let operation: CmsUploadOperation;
const success = (data: unknown) => ({ requestId: uuid(9), status: "ok", data, errors: [] });
beforeEach(async () => {
  vi.resetModules(); vi.stubGlobal("crypto", webcrypto); client = await import("./upload-client");
  const description = await client.describeCmsUploadFile(file(), scope.mode);
  operation = { token: Symbol(), attempt: Symbol(), epoch: 1, scope, key: uuid(5), originalId: await client.originalCmsUploadId(scope, uuid(5)),
    file: description, phase: "unknown", reservationId: null, batchId: null, recoveryKey: null, result: null };
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });
const source = (op: CmsUploadOperation, mode = scope.mode) => ({ schema_version: 1, original_operation_id: op.originalId, reservation_id: uuid(6),
  organization_id: scope.organizationId, branch_id: scope.branchId, actor_user_id: scope.actorUserId, mode, file_sha256: op.file.sha256,
  file_name: op.file.name, mime_type: op.file.mime, file_size_bytes: op.file.size, mapping_version: "central-care-plan-html@1",
  created_at: "2026-09-01T00:00:00Z", expires_at: "2026-09-01T00:15:00Z", status: "queued", receipt: null, staging_only: true, formally_imported: false });
describe("CMS upload browser transport", () => {
  it("computes real SHA256, preserving namespaced original key compatibility", async () => {
    const { trustedUploadOperationId } = await import("./trusted-staging");
    expect(operation.originalId).toBe(trustedUploadOperationId({ organizationId: scope.organizationId, branchId: scope.branchId,
      userId: scope.actorUserId, assuranceLevel: "aal1", recentAal2At: null }, operation.key));
    expect(operation.file.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });
  it("same name and size do not admit different bytes", async () => {
    const changed = new File(["<html>same original bytex</html>"], file().name, { type: file().type });
    expect(changed.size).toBe(file().size); const described = await client.describeCmsUploadFile(changed, scope.mode);
    expect(client.sameCmsUploadFile(operation.file, described)).toBe(false);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(client.sendCmsUpload(operation, scope, changed, false, new AbortController().signal)).rejects.toThrow(/檔案與原上傳不同/u);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("locator is one queryless GET with original header, never replay or file body", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(success({ found: false, operation: null }))); vi.stubGlobal("fetch", fetcher);
    expect(await client.locateCmsUploadResult(operation, scope, new AbortController().signal)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1); const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/api/client-intake/imports/operations"); expect(url).not.toContain("?");
    expect(init).toMatchObject({ method: "GET", credentials: "same-origin", cache: "no-store", headers: { "idempotency-key": operation.key } });
    expect(init.body).toBeUndefined();
  });
  it.each([{ actor_user_id: uuid(8) }, { branch_id: uuid(8) }, { original_operation_id: uuid(8) }, { file_sha256: "a".repeat(64) },
    { file_size_bytes: 1 }, { mode: "general" }, { status: "completed", receipt: null }, { unexpected: "private" }])("fails uncorrelated locator %j", async change => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(success({ found: true, operation: { ...source(operation), ...change } }))));
    await expect(client.locateCmsUploadResult(operation, scope, new AbortController().signal)).rejects.toThrow();
  });
  it("accepts expired source history with current caller identity", async () => {
    const proof = source(operation); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(success({ found: true, operation: proof }))));
    expect(await client.locateCmsUploadResult(operation, scope, new AbortController().signal)).toEqual(proof);
  });
  it.each(["locator", "upload"])("%s JSON decoding has a deadline even when decoder ignores abort", async kind => {
    vi.useFakeTimers(); let decode!: (value: unknown) => void; const held = new Promise(done => { decode = done; });
    const fetcher = vi.fn().mockResolvedValue({ status: 200, ok: true, redirected: false, json: () => held }); vi.stubGlobal("fetch", fetcher);
    const pending = (kind === "locator" ? client.locateCmsUploadResult(operation, scope, new AbortController().signal) :
      client.sendCmsUpload(operation, scope, file(), false, new AbortController().signal)).catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(20_000); expect(await pending).toBeInstanceOf(Error);
    expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true);
    decode(success({ found: false, operation: null })); await vi.advanceTimersByTimeAsync(0); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("already aborted lookup does not dispatch", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); const controller = new AbortController(); controller.abort();
    await expect(client.locateCmsUploadResult(operation, scope, controller.signal)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("explicit recovery uses source reservation with distinct recovery key and original bytes", async () => {
    const receipt = { reservation_id: uuid(6), status: "completed", staging_only: true, formally_imported: false, file_sha256: operation.file.sha256,
      content_fingerprint: "b".repeat(64), payload_sha256: "c".repeat(64), mapping_version: "central-care-plan-html@1", section_count: 1, field_count: 2,
      completed_at: "2026-09-02T00:00:00Z", replayed: false };
    const fetcher = vi.fn().mockResolvedValue(Response.json(success(receipt))); vi.stubGlobal("fetch", fetcher);
    const recovering = { ...operation, reservationId: uuid(6), recoveryKey: uuid(7) };
    const result = await client.sendCmsUpload(recovering, scope, file(), true, new AbortController().signal);
    expect(result).toMatchObject({ batchId: uuid(6), reservationId: uuid(6), payloadSha256: "c".repeat(64), fieldCount: 2 });
    const [url, init] = fetcher.mock.calls[0]!; expect(url).toBe("/api/client-intake/imports/recovery");
    expect(init.headers["idempotency-key"]).toBe(uuid(7)); expect(init.body.get("original_operation_key")).toBe(operation.key);
    expect(init.body.get("reservation_id")).toBe(uuid(6)); expect(init.body.get("file")).toBeInstanceOf(File);
  });
});
