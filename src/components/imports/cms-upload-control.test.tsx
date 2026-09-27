// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import type { CmsUploadMode, CmsUploadOperation } from "@/lib/imports/upload-pending";
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context: TenantContext = { organizationId: uuid(1), organizationName: "Synthetic", branchId: uuid(2), branchName: "Synthetic",
  userId: uuid(3), displayName: "Synthetic", roles: ["case_manager_social_worker"],
  scopes: ["imports.manage", "clients.read", "clients.demographics.read", "clients.manage", "clients.view_all"], assuranceLevel: "aal1", recentAal2At: null, demo: false };
let journal: typeof import("@/lib/imports/upload-pending"), client: typeof import("@/lib/imports/upload-client");
let Control: typeof import("./cms-upload-control").CmsUploadControl;
const file = (changed = false) => new File([`<html>same original byte${changed ? "x" : "s"}</html>`], "synthetic.html", { type: "text/html" });
const envelope = (data: unknown) => ({ requestId: uuid(9), status: "ok", data, errors: [] });
const input = () => screen.getByLabelText(/CMS HTML/u) as HTMLInputElement;
const check = () => screen.getByRole("button", { name: "確認上傳結果" });
beforeEach(async () => {
  vi.resetModules(); vi.stubGlobal("crypto", webcrypto);
  // Use genuine FileReader and WebCrypto, preserving browser byte semantics.
  Object.defineProperty(File.prototype, "arrayBuffer", { configurable: true, value(this: File) {
    return new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(this); });
  } });
  journal = await import("@/lib/imports/upload-pending"); client = await import("@/lib/imports/upload-client");
  Control = (await import("./cms-upload-control")).CmsUploadControl;
});
afterEach(() => { cleanup(); journal.clearCmsUploadOnLogout(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
function current(mode: CmsUploadMode) { return mode === "general" ? { ...context, assuranceLevel: "aal2" as const } : context; }
async function seed(mode: CmsUploadMode = "routine-intake") {
  const actor = current(mode), scope = journal.cmsUploadScope(actor, mode, null); journal.observeCmsUploadAuthority(scope.authority);
  const metadata = await client.describeCmsUploadFile(file(), mode), key = uuid(5);
  const operation = journal.beginCmsUpload(scope, metadata, key, await client.originalCmsUploadId(scope, key))!;
  journal.markCmsUploadUnknown(operation, scope); return { scope, operation: journal.getCmsUploadOperation(scope)!, context: actor };
}
function source(operation: CmsUploadOperation, completed = false) {
  const receipt = { reservation_id: uuid(6), status: "completed", staging_only: true, formally_imported: false, file_sha256: operation.file.sha256,
    payload_sha256: "c".repeat(64), content_fingerprint: "b".repeat(64), mapping_version: "central-care-plan-html@1",
    section_count: 1, field_count: 2, completed_at: "2026-09-02T00:00:00Z", replayed: false };
  return { schema_version: 1, original_operation_id: operation.originalId, reservation_id: uuid(6), organization_id: operation.scope.organizationId,
    branch_id: operation.scope.branchId, actor_user_id: operation.scope.actorUserId, mode: operation.scope.mode, file_sha256: operation.file.sha256,
    file_name: operation.file.name, mime_type: operation.file.mime, file_size_bytes: operation.file.size, mapping_version: "central-care-plan-html@1",
    created_at: "2026-09-01T00:00:00Z", expires_at: "2026-09-01T00:15:00Z", status: completed ? "completed" : "queued",
    receipt: completed ? receipt : null, staging_only: true, formally_imported: false };
}
describe("shared CMS upload recovery control", () => {
  it("duplicate clicks including original byte reading dispatch exactly one upload", async () => {
    const actor = context, scope = journal.cmsUploadScope(actor, "routine-intake", null); journal.observeCmsUploadAuthority(scope.authority);
    const fetcher = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetcher);
    const reading = vi.spyOn(FileReader.prototype, "readAsArrayBuffer");
    render(<Control context={actor} mode="routine-intake" enabled onPreview={vi.fn()} />);
    fireEvent.change(input(), { target: { files: [file()] } }); fireEvent.change(input(), { target: { files: [file(true)] } });
    expect(reading).toHaveBeenCalledTimes(1); expect(fetcher).not.toHaveBeenCalled();
    await screen.findByText(/已選取原檔/u); const upload = screen.getByRole("button", { name: "上傳並核對資料" });
    fireEvent.click(upload); fireEvent.click(upload); await screen.findByRole("alert"); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(journal.getCmsUploadOperation(scope)!.phase).toBe("unknown"); expect(journal.getCmsUploadOperation(scope)!.file.size).toBe(file().size);
  });
  it("remount retains unknown original metadata but neither File nor automatic replay", async () => {
    const test = await seed(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const view = render(<Control context={test.context} mode="routine-intake" enabled onPreview={vi.fn()} />); view.unmount();
    render(<Control context={test.context} mode="routine-intake" enabled onPreview={vi.fn()} />);
    expect(input().files?.length ?? 0).toBe(0); expect(check()).toBeDefined(); expect(fetcher).not.toHaveBeenCalled();
    const operation = journal.getCmsUploadOperation(test.scope)!; expect(operation.key).toBe(test.operation.key); expect(operation.file).toEqual(test.operation.file);
    expect(screen.getByRole("button", { name: "繼續原上傳" })).toHaveProperty("disabled", true);
  });
  it("missing lookup stays unknown without replaying or ending the guard", async () => {
    const test = await seed(), preview = vi.fn(), fetcher = vi.fn().mockResolvedValue(Response.json(envelope({ found: false, operation: null })));
    vi.stubGlobal("fetch", fetcher); render(<Control context={test.context} mode="routine-intake" enabled onPreview={preview} />);
    fireEvent.click(check()); await screen.findByText(/尚未查到原操作/u);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0]![0]).toBe("/api/client-intake/imports/operations");
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: "GET", headers: { "idempotency-key": test.operation.key } });
    expect(preview).not.toHaveBeenCalled(); expect(journal.hasCmsUploadOperation()).toBe(true);
  });
  it("same-name same-size changed bytes cannot replace an unknown original", async () => {
    const test = await seed(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    render(<Control context={test.context} mode="routine-intake" enabled onPreview={vi.fn()} />);
    fireEvent.change(input(), { target: { files: [file(true)] } }); await screen.findByText(/檔案與原上傳不同/u);
    expect(fetcher).not.toHaveBeenCalled(); expect(journal.getCmsUploadOperation(test.scope)!.key).toBe(test.operation.key);
    expect(input().value).toBe("");
  });
  it("completed general source requires explicit repository attachment and never previews itself", async () => {
    const test = await seed("general"), preview = vi.fn(), fetcher = vi.fn().mockResolvedValue(Response.json(envelope({ found: true, operation: source(test.operation, true) })));
    vi.stubGlobal("fetch", fetcher); render(<Control context={test.context} mode="general" enabled onPreview={preview} />);
    fireEvent.click(check()); await screen.findByText(/原檔已上傳/u); expect(preview).not.toHaveBeenCalled();
    expect(journal.hasCmsUploadOperation()).toBe(true); expect(journal.getCmsUploadOperation(test.scope)!.reservationId).toBe(uuid(6));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("completed routine source previews exact receipt payload and finishes only after correlated preview", async () => {
    const test = await seed(), preview = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(envelope({ found: true, operation: source(test.operation, true) }))));
    render(<Control context={test.context} mode="routine-intake" enabled onPreview={preview} />); fireEvent.click(check());
    await screen.findByText(/已取得核對資料/u); expect(preview).toHaveBeenCalledTimes(1);
    expect(preview.mock.calls[0]![0]).toEqual({ batchId: uuid(6), reservationId: uuid(6), fileSha256: test.operation.file.sha256,
      payloadSha256: "c".repeat(64), mappingVersion: "central-care-plan-html@1", contentFingerprint: "b".repeat(64), sectionCount: 1, fieldCount: 2 });
    expect(journal.hasCmsUploadOperation()).toBe(false);
  });
  it("failed correlated source preview retains guard and allows preview-only retry", async () => {
    const test = await seed(), preview = vi.fn().mockRejectedValue(new Error("PRIVATE_PREVIEW"));
    const fetcher = vi.fn().mockResolvedValue(Response.json(envelope({ found: true, operation: source(test.operation, true) }))); vi.stubGlobal("fetch", fetcher);
    render(<Control context={test.context} mode="routine-intake" enabled onPreview={preview} />); fireEvent.click(check());
    await screen.findByRole("alert"); expect(screen.getByRole("alert").textContent).not.toContain("PRIVATE_PREVIEW");
    expect(journal.hasCmsUploadOperation()).toBe(true); expect(screen.getByRole("button", { name: "重新載入核對資料" })).toHaveProperty("disabled", false);
    preview.mockResolvedValue(undefined); fireEvent.click(screen.getByRole("button", { name: "重新載入核對資料" }));
    await screen.findByText(/已取得核對資料/u); expect(fetcher).toHaveBeenCalledTimes(1); expect(preview).toHaveBeenCalledTimes(2);
  });
  it("unmount aborts a pending read and hides late callbacks after remount", async () => {
    const test = await seed(), preview = vi.fn(); let resolve!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise(done => { resolve = done; })); vi.stubGlobal("fetch", fetcher);
    const view = render(<Control context={test.context} mode="routine-intake" enabled onPreview={preview} />);
    fireEvent.click(check()); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); view.unmount();
    render(<Control context={test.context} mode="routine-intake" enabled onPreview={preview} />);
    await act(async () => { resolve(Response.json(envelope({ found: true, operation: source(test.operation, true) }))); });
    expect(preview).not.toHaveBeenCalled(); expect(journal.hasCmsUploadOperation()).toBe(true); expect(check()).toHaveProperty("disabled", false);
  });
  it("logout cancels pending read and prevents late preview disclosure", async () => {
    const test = await seed(), preview = vi.fn(); let resolve!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise(done => { resolve = done; })); vi.stubGlobal("fetch", fetcher);
    render(<Control context={test.context} mode="routine-intake" enabled onPreview={preview} />); fireEvent.click(check());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); act(() => journal.clearCmsUploadOnLogout());
    await act(async () => { resolve(Response.json(envelope({ found: true, operation: source(test.operation, true) }))); });
    expect(preview).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "確認上傳結果" })).toBeNull();
  });
  it.each(["denied-read", "logout"])("%s unmounts selected native file UI before unchanged server props can revive it", async kind => {
    const test = await seed(), preview = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(Response.json({ requestId: uuid(9), status: "error", data: null,
      errors: [{ code: "FORBIDDEN", message: "PRIVATE_PROVIDER_DENIAL" }] }, { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<Control context={test.context} mode="routine-intake" enabled onPreview={preview} />);
    fireEvent.change(input(), { target: { files: [file()] } }); await screen.findByText(/原檔核對相同/u);
    const previousInput = input(); expect(previousInput.files?.length).toBe(1);
    if (kind === "denied-read") { fireEvent.click(check()); await waitFor(() => expect(journal.canUseCmsUpload(test.scope)).toBe(false)); }
    else act(() => journal.clearCmsUploadOnLogout());
    expect(previousInput.isConnected).toBe(false); expect(input().files?.length ?? 0).toBe(0);
    expect(input()).toHaveProperty("disabled", true); expect(screen.queryByText(/原檔核對相同/u)).toBeNull();
    expect(screen.queryByText(/PRIVATE_PROVIDER_DENIAL/u)).toBeNull(); expect(preview).not.toHaveBeenCalled();
    act(() => journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(test.context)));
    view.rerender(<Control context={test.context} mode="routine-intake" enabled onPreview={preview} />);
    expect(input().files?.length ?? 0).toBe(0); expect(input()).toHaveProperty("disabled", true);
    expect(journal.hasCmsUploadOperation()).toBe(kind === "denied-read"); expect(fetcher).toHaveBeenCalledTimes(kind === "denied-read" ? 1 : 0);
  });
  it("authority ABA rejects old pending reply and re-enables a fresh current-scope read", async () => {
    const test = await seed(), preview = vi.fn(); let resolve!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise(done => { resolve = done; })); vi.stubGlobal("fetch", fetcher);
    const view = render(<Control context={test.context} mode="routine-intake" enabled onPreview={preview} />); fireEvent.click(check());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); const other = { ...test.context, branchId: uuid(8) };
    act(() => journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(other)));
    view.rerender(<Control context={other} mode="routine-intake" enabled onPreview={preview} />);
    act(() => journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(test.context)));
    view.rerender(<Control context={test.context} mode="routine-intake" enabled onPreview={preview} />);
    await act(async () => { resolve(Response.json(envelope({ found: true, operation: source(test.operation, true) }))); });
    expect(preview).not.toHaveBeenCalled(); await waitFor(() => expect(check()).toHaveProperty("disabled", false));
  });
  it("scope ABA during an abort-ignoring preview cannot leave the control permanently busy", async () => {
    const test = await seed(); let resolve!: () => void;
    const preview = vi.fn().mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(envelope({ found: true, operation: source(test.operation, true) }))));
    const view = render(<Control context={test.context} mode="routine-intake" enabled onPreview={preview} />); fireEvent.click(check());
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    expect(view.container.querySelector("section")!.getAttribute("aria-busy")).toBe("true");
    const other = { ...test.context, branchId: uuid(8) };
    act(() => journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(other)));
    view.rerender(<Control context={other} mode="routine-intake" enabled onPreview={preview} />);
    act(() => journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(test.context)));
    view.rerender(<Control context={test.context} mode="routine-intake" enabled onPreview={preview} />);
    await act(async () => resolve()); expect(journal.hasCmsUploadOperation()).toBe(true);
    await waitFor(() => expect(check()).toHaveProperty("disabled", false));
  });
  it("new branch props clear previously selected local bytes and stale status", async () => {
    const scope = journal.cmsUploadScope(context, "routine-intake", null); journal.observeCmsUploadAuthority(scope.authority);
    const view = render(<Control context={context} mode="routine-intake" enabled onPreview={vi.fn()} />);
    fireEvent.change(input(), { target: { files: [file()] } }); await screen.findByText(/已選取原檔/u);
    const other = { ...context, branchId: uuid(8) }; act(() => journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(other)));
    view.rerender(<Control context={other} mode="routine-intake" enabled onPreview={vi.fn()} />);
    expect(screen.queryByText(/已選取原檔/u)).toBeNull();
    expect(screen.getByRole("button", { name: "上傳並核對資料" })).toHaveProperty("disabled", true);
  });
});
