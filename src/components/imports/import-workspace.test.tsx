// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createHash, webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import type { CmsUploadOperation } from "@/lib/imports/upload-pending";

const uuid = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const bytes = `<html>${"x".repeat(18)}</html>`;
const context: TenantContext = { organizationId: uuid(3), organizationName: "Synthetic", branchId: uuid(4), branchName: "Synthetic",
  userId: uuid(5), displayName: "Synthetic", roles: ["organization_manager"], scopes: ["imports.manage", "imports.approve"],
  assuranceLevel: "aal2", recentAal2At: "2026-09-01T00:00:00.000Z", demo: false };
const batch = {
  id: uuid(1), version: 1, status: "parsed", fileName: "sample.html", byteLength: 31,
  fileSha256: createHash("sha256").update(bytes).digest("hex"), contentFingerprint: "b".repeat(64),
  mappingVersion: "central-care-plan-html@1", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  sectionCount: 0, fieldCount: 0, warningCount: 0, conflictCount: 0,
  security: { parser: "cheerio-static", scriptElementsBlocked: 0, formElementsNeutralized: 0, redirectElementsBlocked: 0,
    activeElementsBlocked: 0, inlineEventHandlersBlocked: 0, externalReferencesBlocked: 0, externalRequestCount: 0 },
} as const;
let journal: typeof import("@/lib/imports/upload-pending");
let locks: typeof import("@/lib/navigation/pending-operation-lock");
let client: typeof import("@/lib/imports/upload-client");
let Workspace: typeof import("./import-workspace").ImportWorkspace;
const envelope = (data: unknown) => ({ requestId: uuid(2), status: "ok", data, errors: [] });
const response = (data: unknown, status = 200) => Response.json(envelope(data), { status });
const previewData = (value: object = batch) => ({ batch: value, sections: [], fields: [], warnings: [], conflicts: [] });
const uploadResponse = (value: object = batch, status = 201, replayed = false, duplicate = false) => response({
  status: duplicate ? "duplicate" : "parsed", batch: value, replayed, duplicate }, status);
const unavailable = (status = 503) => Response.json({ requestId: uuid(2), status: "error", data: null,
  errors: [{ code: "IMPORT_STORAGE_NOT_CONFIGURED", message: "PRIVATE_PROVIDER_TOKEN_AND_CONTENT" }] }, { status });
const input = () => screen.getByLabelText(/CMS HTML/u) as HTMLInputElement;
const upload = () => screen.getByRole("button", { name: "上傳並預覽" });
const reparse = () => screen.getByRole("button", { name: "重新解析" });
const currentScope = () => journal.cmsUploadScope(context, "general", null);
const originalFile = (name = "sample.html") => new File([bytes], name, { type: "text/html" });

beforeEach(async () => {
  vi.resetModules(); vi.stubGlobal("crypto", webcrypto);
  Object.defineProperty(File.prototype, "arrayBuffer", { configurable: true, value(this: File) {
    return new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(this); });
  } });
  journal = await import("@/lib/imports/upload-pending"); locks = await import("@/lib/navigation/pending-operation-lock");
  client = await import("@/lib/imports/upload-client"); Workspace = (await import("./import-workspace")).ImportWorkspace;
  journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(context));
});
afterEach(() => { cleanup(); journal.clearCmsUploadOnLogout(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function choose(file = originalFile()) {
  fireEvent.change(input(), { target: { files: [file] } }); await screen.findByText(/已選取原檔/u); return file;
}
async function initialPreview(fetcher: ReturnType<typeof vi.fn>) {
  fetcher.mockResolvedValueOnce(uploadResponse()).mockResolvedValueOnce(response(previewData()));
  vi.stubGlobal("fetch", fetcher); const view = render(<Workspace context={context} />);
  await choose(); fireEvent.click(upload()); await screen.findByRole("heading", { name: "2. 解析預覽" });
  await waitFor(() => expect(reparse()).toBeEnabled()); return view;
}
async function seedUnknown(actor: TenantContext = context) {
  const scope = journal.cmsUploadScope(actor, "general", null); journal.observeCmsUploadAuthority(scope.authority);
  const file = await client.describeCmsUploadFile(originalFile(), "general"); const key = uuid(20);
  const pending = journal.beginCmsUpload(scope, file, key, await client.originalCmsUploadId(scope, key))!;
  journal.markCmsUploadUnknown(pending, scope); return journal.getCmsUploadOperation(scope)!;
}
function located(operation: CmsUploadOperation, completed = false) {
  return { schema_version: 1, original_operation_id: operation.originalId, reservation_id: uuid(21), organization_id: operation.scope.organizationId,
    branch_id: operation.scope.branchId, actor_user_id: operation.scope.actorUserId, mode: "general", file_sha256: operation.file.sha256,
    file_name: operation.file.name, mime_type: operation.file.mime, file_size_bytes: operation.file.size, mapping_version: batch.mappingVersion,
    created_at: "2026-09-01T00:00:00Z", expires_at: "2026-09-01T00:15:00Z", status: completed ? "completed" : "queued",
    receipt: completed ? { reservation_id: uuid(21), status: "completed", staging_only: true, formally_imported: false,
      file_sha256: operation.file.sha256, payload_sha256: "c".repeat(64), mapping_version: batch.mappingVersion,
      content_fingerprint: batch.contentFingerprint, section_count: 0, field_count: 0, completed_at: "2026-09-02T00:00:00Z", replayed: false } : null,
    staging_only: true, formally_imported: false };
}

describe("general ImportWorkspace shared upload integration", () => {
  it("describes the distinct three stages, without formal promotion or fake drag/drop", () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); render(<Workspace context={context} />);
    for (const label of ["等待解析", "待核對／暫存核准", "正式入檔尚未完成"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /核准|正式入檔/u })).toBeNull();
    expect(screen.queryByText(/拖放/u)).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects same-name same-size different-byte receipts before preview and retries only original key after lookup", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(uploadResponse({ ...batch, fileSha256: "c".repeat(64) }))
      .mockResolvedValueOnce(response({ found: false, operation: null })).mockResolvedValueOnce(uploadResponse(batch, 200, true))
      .mockResolvedValueOnce(response(previewData())); vi.stubGlobal("fetch", fetcher);
    render(<Workspace context={context} />); await choose(); fireEvent.click(upload()); await screen.findByRole("alert");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(screen.queryByRole("heading", { name: "2. 解析預覽" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "確認上傳結果" })); await screen.findByText(/尚未查到原操作/u);
    fireEvent.click(screen.getByRole("button", { name: "繼續原上傳" })); await screen.findByRole("heading", { name: "2. 解析預覽" });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[2]![1].headers["idempotency-key"]).toBe(fetcher.mock.calls[0]![1].headers["idempotency-key"]);
    expect(journal.hasCmsUploadOperation()).toBe(false);
  });
  it("accepts renamed same-byte duplicate without presenting staging imported as formal client entry", async () => {
    const staged = { ...batch, status: "imported" };
    const fetcher = vi.fn().mockResolvedValueOnce(uploadResponse({ ...staged, status: "duplicate" }, 200, true, true))
      .mockResolvedValueOnce(response(previewData(staged))); vi.stubGlobal("fetch", fetcher);
    render(<Workspace context={context} />); await choose(originalFile("renamed.html")); fireEvent.click(upload());
    await screen.findByRole("heading", { name: "2. 解析預覽" });
    expect(screen.queryByText("已匯入")).toBeNull(); expect(screen.getByText("imported").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText(batch.fileSha256).closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByRole("button", { name: /核准|正式入檔/u })).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("blocks replacement, duplicate submits and reparse while original upload is unresolved", async () => {
    let done!: (r: Response) => void; const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { done = resolve; }));
    vi.stubGlobal("fetch", fetcher); render(<Workspace context={context} />); await choose();
    const button = upload(); fireEvent.click(button); fireEvent.click(button); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(input()).toBeDisabled(); expect(reparse()).toBeDisabled();
    fireEvent.change(input(), { target: { files: [new File(["other"], "other.html", { type: "text/html" })] } });
    await act(async () => done(response({}))); await screen.findByRole("alert");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(journal.getCmsUploadOperation(currentScope())!.file.name).toBe("sample.html");
  });
  it("safe upload 503 cannot expose provider text or silently retry without lookup", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(unavailable()); vi.stubGlobal("fetch", fetcher);
    render(<Workspace context={context} />); await choose(); fireEvent.click(upload()); await screen.findByRole("alert");
    expect(screen.queryByText(/PRIVATE_PROVIDER/u)).toBeNull(); expect(screen.queryByRole("heading", { name: "2. 解析預覽" })).toBeNull();
    expect(screen.getByRole("button", { name: "繼續原上傳" })).toBeDisabled(); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(journal.hasCmsUploadOperation()).toBe(true);
  });
  it("unknown upload requires manual observational lookup before exact original-key retry", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("PRIVATE_OFFLINE"))
      .mockResolvedValueOnce(response({ found: false, operation: null })).mockResolvedValueOnce(uploadResponse())
      .mockResolvedValueOnce(response(previewData())); vi.stubGlobal("fetch", fetcher);
    render(<Workspace context={context} />); await choose(); fireEvent.click(upload()); await screen.findByRole("alert");
    expect(screen.queryByText(/PRIVATE_OFFLINE/u)).toBeNull(); expect(screen.getByRole("button", { name: "繼續原上傳" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "確認上傳結果" })); await screen.findByText(/尚未查到原操作/u);
    expect(journal.hasCmsUploadOperation()).toBe(true); fireEvent.click(screen.getByRole("button", { name: "繼續原上傳" }));
    await screen.findByRole("heading", { name: "2. 解析預覽" }); expect(fetcher.mock.calls[1]![0]).toBe("/api/imports/operations");
    expect(fetcher.mock.calls[2]![1].headers["idempotency-key"]).toBe(fetcher.mock.calls[0]![1].headers["idempotency-key"]);
  });
  it("staged result survives failed preview and retries GET only without another POST", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(uploadResponse()).mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(response(previewData())); vi.stubGlobal("fetch", fetcher);
    render(<Workspace context={context} />); await choose(); fireEvent.click(upload()); await screen.findByRole("alert");
    expect(screen.getByText("管理檢查明細：匯入服務設定").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText(/PRIVATE_PROVIDER/u)).toBeNull(); expect(journal.getCmsUploadOperation(currentScope())!.result?.batchId).toBe(batch.id);
    fireEvent.click(screen.getByRole("button", { name: "重新載入核對資料" })); await screen.findByRole("heading", { name: "2. 解析預覽" });
    expect(fetcher).toHaveBeenCalledTimes(3); expect(fetcher.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(1);
  });
  it("completed general source is not a batch preview; only explicit original-file recovery attaches it", async () => {
    const op = await seedUnknown(); const fetcher = vi.fn().mockResolvedValueOnce(response({ found: true, operation: located(op, true) }))
      .mockResolvedValueOnce(response({ status: "parsed", batch, duplicate: false, replayed: false, staging_only: true, formally_imported: false }, 201))
      .mockResolvedValueOnce(response(previewData())); vi.stubGlobal("fetch", fetcher); render(<Workspace context={context} />);
    fireEvent.click(screen.getByRole("button", { name: "確認上傳結果" })); await screen.findByText(/原檔已上傳/u);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(screen.queryByRole("heading", { name: "2. 解析預覽" })).toBeNull();
    fireEvent.change(input(), { target: { files: [originalFile()] } }); await screen.findByText(/原檔核對相同/u);
    fireEvent.click(screen.getByRole("button", { name: "繼續原上傳" })); await screen.findByRole("heading", { name: "2. 解析預覽" });
    expect(fetcher.mock.calls[1]![0]).toBe("/api/imports/recovery"); const form = fetcher.mock.calls[1]![1].body as FormData;
    expect(form.get("original_operation_key")).toBe(op.key); expect(form.get("reservation_id")).toBe(uuid(21));
    expect(form.get("idempotency_key")).not.toBe(op.key); expect(journal.hasCmsUploadOperation()).toBe(false);
  });
  it("remount restores staged preview retry, never File bytes or automatic POST", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(uploadResponse()).mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(response(previewData())); vi.stubGlobal("fetch", fetcher);
    const view = render(<Workspace context={context} />); await choose(); fireEvent.click(upload()); await screen.findByRole("alert"); view.unmount();
    render(<Workspace context={context} />); expect(fetcher).toHaveBeenCalledTimes(2); expect(input().files).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "重新載入核對資料" })); await screen.findByRole("heading", { name: "2. 解析預覽" });
    expect(fetcher).toHaveBeenCalledTimes(3); expect(fetcher.mock.calls[2]![1].method).toBe("GET");
  });
  it.each([{ id: uuid(90) }, { fileSha256: "c".repeat(64) }, { byteLength: 30 }, { mappingVersion: "unknown@1" },
    { contentFingerprint: "d".repeat(64) }, { sectionCount: 1 }, { fieldCount: 1 }])("rejects preview mismatch %j and quarantines stale content", async change => {
    const fetcher = vi.fn().mockResolvedValueOnce(uploadResponse()).mockResolvedValueOnce(response(previewData({ ...batch, ...change })));
    vi.stubGlobal("fetch", fetcher); render(<Workspace context={context} />); await choose(); fireEvent.click(upload()); await screen.findByRole("alert");
    expect(screen.queryByRole("heading", { name: "2. 解析預覽" })).toBeNull(); expect(journal.hasCmsUploadOperation()).toBe(true);
    expect(journal.canUseCmsUpload(currentScope())).toBe(false); expect(reparse()).toBeDisabled(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403])("denied preview %s hides data and retains unknown original", async status => {
    const fetcher = vi.fn().mockResolvedValueOnce(uploadResponse()).mockResolvedValueOnce(unavailable(status)); vi.stubGlobal("fetch", fetcher);
    render(<Workspace context={context} />); await choose(); fireEvent.click(upload()); await screen.findByRole("alert");
    expect(journal.hasCmsUploadOperation()).toBe(true); expect(journal.canUseCmsUpload(currentScope())).toBe(false);
    expect(screen.queryByRole("heading", { name: "2. 解析預覽" })).toBeNull(); expect(screen.queryByText(/PRIVATE_PROVIDER/u)).toBeNull();
  });
  it("new selected bytes clear old preview before any new upload", async () => {
    const fetcher = vi.fn(); await initialPreview(fetcher); await choose(originalFile("next.html"));
    expect(screen.queryByRole("heading", { name: "2. 解析預覽" })).toBeNull(); expect(reparse()).toBeDisabled(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("invalid new selection removes old preview too; it cannot leave stale actions active", async () => {
    const fetcher = vi.fn(); await initialPreview(fetcher);
    fireEvent.change(input(), { target: { files: [new File(["invalid"], "not-html.pdf", { type: "application/pdf" })] } });
    await screen.findByRole("alert"); expect(screen.queryByRole("heading", { name: "2. 解析預覽" })).toBeNull();
    expect(reparse()).toBeDisabled(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([{ assuranceLevel: "aal1" as const }, { demo: true }, { scopes: [] }])("no permitted general authority %j means no write", async change => {
    const actor = { ...context, ...change }; journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(actor));
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); render(<Workspace context={actor} />);
    expect(input()).toBeDisabled(); expect(upload()).toBeDisabled(); expect(reparse()).toBeDisabled();
    fireEvent.click(upload()); expect(fetcher).not.toHaveBeenCalled();
  });
  it("preview GET is bodyless, no-store, same-origin and redirect rejecting", async () => {
    const fetcher = vi.fn(); await initialPreview(fetcher);
    expect(fetcher.mock.calls[1]![0]).toBe(`/api/imports/${batch.id}/preview`);
    expect(fetcher.mock.calls[1]![1]).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error" });
    expect(fetcher.mock.calls[1]![1].body).toBeUndefined();
  });
  it("foreign pending upload hides preview and prevents stale reparse", async () => {
    const fetcher = vi.fn(); await initialPreview(fetcher); const other = { ...context, branchId: uuid(41) };
    await act(async () => { await seedUnknown(other); }); act(() => journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(context)));
    expect(screen.queryByRole("heading", { name: "2. 解析預覽" })).toBeNull(); expect(reparse()).toBeDisabled();
    expect(screen.getByText(/另一項 CMS 上傳/u)).toBeInTheDocument(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("authority ABA cannot revive an accepted preview or reparse it", async () => {
    const fetcher = vi.fn(); await initialPreview(fetcher);
    act(() => { journal.observeCmsUploadAuthority(journal.cmsUploadAuthority({ ...context, branchId: uuid(41) }));
      journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(context)); });
    expect(screen.queryByRole("heading", { name: "2. 解析預覽" })).toBeNull(); expect(reparse()).toBeDisabled(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(["unmount", "logout", "ABA"] as const)("late abort-ignoring preview JSON cannot disclose after %s", async kind => {
    let done!: (v: unknown) => void; const json = vi.fn().mockImplementation(() => new Promise(resolve => { done = resolve; }));
    const fetcher = vi.fn().mockResolvedValueOnce(uploadResponse()).mockResolvedValueOnce({ status: 200, redirected: false, json });
    vi.stubGlobal("fetch", fetcher); const view = render(<Workspace context={context} />); await choose(); fireEvent.click(upload());
    await waitFor(() => expect(json).toHaveBeenCalledTimes(1));
    if (kind === "unmount") { view.unmount(); render(<Workspace context={context} />); }
    else act(() => { if (kind === "logout") journal.clearCmsUploadOnLogout(); else {
      journal.observeCmsUploadAuthority(journal.cmsUploadAuthority({ ...context, scopes: [] })); journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(context)); } });
    await act(async () => done(envelope(previewData()))); expect(screen.queryByRole("heading", { name: "2. 解析預覽" })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2); expect(journal.hasCmsUploadOperation()).toBe(kind !== "logout");
  });
  it("preview JSON has an independent 20-second deadline, including abort-ignoring decoder", async () => {
    const op = await seedUnknown(); const staged = journal.markCmsUploadStaged(op, currentScope(), { batchId: batch.id,
      reservationId: null, fileSha256: batch.fileSha256, payloadSha256: null, mappingVersion: batch.mappingVersion,
      contentFingerprint: batch.contentFingerprint, sectionCount: 0, fieldCount: 0 })!;
    journal.markCmsUploadUnknown(staged, currentScope());
    let done!: (v: unknown) => void; const json = vi.fn().mockImplementation(() => new Promise(resolve => { done = resolve; }));
    const fetcher = vi.fn().mockResolvedValueOnce({ status: 200, redirected: false, json });
    vi.stubGlobal("fetch", fetcher); render(<Workspace context={context} />); vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重新載入核對資料" }));
      for (let i = 0; i < 20; i++) await Promise.resolve(); });
    expect(json).toHaveBeenCalledTimes(1); await act(async () => { await vi.advanceTimersByTimeAsync(20_001); }); vi.useRealTimers();
    await screen.findByRole("alert"); expect(journal.hasCmsUploadOperation()).toBe(true);
    await act(async () => done(envelope(previewData()))); expect(screen.queryByRole("heading", { name: "2. 解析預覽" })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("preserved explicit general reparse", () => {
  it("unknown reparse retries original key/body and correlates refreshed snapshot", async () => {
    const next = { ...batch, version: 2, updatedAt: "2026-09-01T00:01:00.000Z" }; const fetcher = vi.fn(); await initialPreview(fetcher);
    fetcher.mockRejectedValueOnce(new Error("PRIVATE_REPARSE")).mockResolvedValueOnce(response(next)).mockResolvedValueOnce(response(previewData(next)));
    fireEvent.click(reparse()); await screen.findByRole("alert"); expect(input()).toBeDisabled(); expect(locks.hasPendingOperations()).toBe(false);
    expect(screen.queryByText(/PRIVATE_REPARSE/u)).toBeNull(); fireEvent.click(reparse()); await screen.findByText(/重新解析並刷新預覽/u);
    expect(fetcher.mock.calls[3]![1].headers).toEqual(fetcher.mock.calls[2]![1].headers);
    expect(fetcher.mock.calls[3]![1].body).toBe(fetcher.mock.calls[2]![1].body);
    expect(fetcher.mock.calls[4]![0]).toBe(`/api/imports/${batch.id}/preview`); expect(locks.hasPendingOperations()).toBe(false);
  });
  it.each(["reparse", "refresh"] as const)("%s 503 remains safe and does not mark incomplete work complete", async phase => {
    const fetcher = vi.fn(); await initialPreview(fetcher);
    if (phase === "reparse") fetcher.mockResolvedValueOnce(unavailable());
    else fetcher.mockResolvedValueOnce(response({ ...batch, version: 2 })).mockResolvedValueOnce(unavailable());
    fireEvent.click(reparse()); await screen.findByRole("alert"); expect(screen.getByRole("alert")).toHaveTextContent("尚未確認");
    expect(screen.getByRole("alert")).toHaveTextContent("請聯絡管理員"); expect(screen.queryByText(/PRIVATE_PROVIDER/u)).toBeNull();
    expect(screen.queryByText(/已使用相同映射版本/u)).toBeNull(); expect(screen.getByText("正式入檔尚未完成")).toBeInTheDocument();
    expect(locks.hasPendingOperations()).toBe(false); expect(input()).toBeDisabled();
  });
  it("known reparse receipt and failed preview retries GET only, never another POST", async () => {
    const next = { ...batch, version: 2 }; const fetcher = vi.fn(); await initialPreview(fetcher);
    fetcher.mockResolvedValueOnce(response(next)).mockResolvedValueOnce(unavailable()).mockResolvedValueOnce(response(previewData(next)));
    fireEvent.click(reparse()); await screen.findByRole("alert"); fireEvent.click(reparse()); await screen.findByText(/重新解析並刷新預覽/u);
    expect(fetcher).toHaveBeenCalledTimes(5); expect(fetcher.mock.calls[4]![1].method).toBe("GET");
    expect(fetcher.mock.calls.filter(c => String(c[0]).endsWith("/reparse"))).toHaveLength(1);
  });
  it.each([{ fileSha256: "e".repeat(64) }, { byteLength: 20 }, { version: 9 }])("bad reparse result %j is never refreshed or exposed", async change => {
    const fetcher = vi.fn(); await initialPreview(fetcher); fetcher.mockResolvedValueOnce(response({ ...batch, version: 2, ...change }));
    fireEvent.click(reparse()); await screen.findByRole("alert"); expect(fetcher).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("heading", { name: "2. 解析預覽" })).toBeNull(); expect(locks.hasPendingOperations()).toBe(false);
  });
  it("foreign write and navigation leases stop reparse without creating any request", async () => {
    const fetcher = vi.fn(); await initialPreview(fetcher); let release!: () => void;
    act(() => { release = locks.tryAcquirePendingOperation()!; }); expect(reparse()).toBeDisabled(); fireEvent.click(reparse());
    expect(fetcher).toHaveBeenCalledTimes(2); act(() => release());
    act(() => { release = locks.tryAcquireViewTransition()!; }); expect(reparse()).toBeDisabled(); fireEvent.click(reparse());
    expect(fetcher).toHaveBeenCalledTimes(2); act(() => release());
  });
  it.each(["ABA", "logout", "unmount"] as const)("late reparse after %s cannot refresh or disclose or leave a dead lease", async kind => {
    const fetcher = vi.fn(); const view = await initialPreview(fetcher); let done!: (v: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { done = resolve; })); fireEvent.click(reparse());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    if (kind === "unmount") { view.unmount(); render(<Workspace context={context} />); }
    else act(() => { if (kind === "logout") journal.clearCmsUploadOnLogout(); else {
      journal.observeCmsUploadAuthority(null); journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(context)); } });
    await act(async () => done(response({ ...batch, version: 2 })));
    expect(fetcher).toHaveBeenCalledTimes(3); expect(screen.queryByRole("heading", { name: "2. 解析預覽" })).toBeNull();
    expect(locks.hasPendingOperations()).toBe(false);
  });
  it("reparse JSON is independently bounded and late completion cannot dispatch preview", async () => {
    const fetcher = vi.fn(); await initialPreview(fetcher); let done!: (v: unknown) => void;
    const json = vi.fn().mockImplementation(() => new Promise(resolve => { done = resolve; }));
    fetcher.mockResolvedValueOnce({ status: 200, redirected: false, json }); vi.useFakeTimers();
    await act(async () => { fireEvent.click(reparse()); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(json).toHaveBeenCalledTimes(1); await act(async () => { await vi.advanceTimersByTimeAsync(20_001); }); vi.useRealTimers();
    await screen.findByRole("alert"); await act(async () => done(envelope({ ...batch, version: 2 })));
    expect(fetcher).toHaveBeenCalledTimes(3); expect(locks.hasPendingOperations()).toBe(false);
    expect(screen.queryByText(/重新解析並刷新預覽/u)).toBeNull();
  });
  it("uncooperative reparse fetch is bounded; late response cannot decode or refresh", async () => {
    const fetcher = vi.fn(); await initialPreview(fetcher); let done!: (v: unknown) => void;
    const json = vi.fn().mockResolvedValue(envelope({ ...batch, version: 2 }));
    fetcher.mockImplementationOnce(() => new Promise(resolve => { done = resolve; })); vi.useFakeTimers();
    await act(async () => { fireEvent.click(reparse()); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_001); }); vi.useRealTimers(); await screen.findByRole("alert");
    await act(async () => done({ status: 200, redirected: false, json }));
    expect(json).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(3); expect(locks.hasPendingOperations()).toBe(false);
  });
  it("full refreshed batch must exactly match known reparse receipt, not merely its version", async () => {
    const next = { ...batch, version: 2 }; const fetcher = vi.fn(); await initialPreview(fetcher);
    fetcher.mockResolvedValueOnce(response(next)).mockResolvedValueOnce(response(previewData({ ...next, contentFingerprint: "f".repeat(64) })));
    fireEvent.click(reparse()); await screen.findByRole("alert");
    expect(screen.queryByRole("heading", { name: "2. 解析預覽" })).toBeNull(); expect(screen.queryByText(/重新解析並刷新預覽/u)).toBeNull();
    expect(journal.canUseCmsUpload(currentScope())).toBe(false); expect(locks.hasPendingOperations()).toBe(false);
  });
});
