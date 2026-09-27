// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { emptyIntakeProfile, type CmsIntakePreview, type IntakeSnapshot } from "@/lib/client-intake/model";
import type { TenantContext } from "@/lib/domain/types";
let IntakeProfileForm: typeof import("./intake-profile-form").IntakeProfileForm;
let CmsIntakeStep: typeof import("./cms-intake-step").CmsIntakeStep;
let IntakeWorkspace: typeof import("./intake-workspace").IntakeWorkspace;
let journal: typeof import("@/lib/imports/upload-pending"), uploadClient: typeof import("@/lib/imports/upload-client");
const id = "c1600000-0000-4000-8000-000000000001";
const other = "c1600000-0000-4000-8000-000000000002";
const context: TenantContext = { organizationId: id, organizationName: "合成機構", branchId: id, branchName: "合成分支", userId: id,
  displayName: "合成收案人員", roles: ["nurse"], scopes: ["clients.read", "clients.manage", "clients.demographics.read", "clients.view_all", "imports.manage", "imports.approve"],
  assuranceLevel: "aal1", recentAal2At: null, demo: false };
const success = (data: unknown) => ({ requestId: other, status: "ok", data, errors: [] });
const originalFile = () => new File(["<h5>合成資料</h5>"], "synthetic.html", { type: "text/html" });
const previewFixture = (current: IntakeSnapshot | null = null): CmsIntakePreview => ({ batchId: id, payloadSha256: "a".repeat(64),
  mappingVersion: "central-care-plan-html@1", fields: [["displayName", "姓名", "合成新個案"], ["identityNumber", "身分識別", "X123456789"]]
    .map(([target, label, value], i) => ({ id: `field-${i}`, intakeTarget: target, normalizedValue: value, rawValue: value, warnings: [],
      source: { sectionCode: "CLIENT_BASIC", sectionTitle: "合成基本資料", label, parentPath: "CLIENT_BASIC/table/tr" } })),
  sections: [{ code: "CLIENT_BASIC", title: "合成基本資料" }], warnings: [], conflicts: [], current, imported: false, importReceipt: null });
async function stagingFixture(file = originalFile()) {
  const description = await uploadClient.describeCmsUploadFile(file, "routine-intake");
  return { reservation_id: id, status: "completed", staging_only: true, formally_imported: false, file_sha256: description.sha256,
    payload_sha256: "a".repeat(64), content_fingerprint: "b".repeat(64), mapping_version: "central-care-plan-html@1",
    section_count: 1, field_count: 2, completed_at: "2026-09-01T00:00:00Z", replayed: false };
}
async function selectAndUpload(file = originalFile()) {
  fireEvent.change(screen.getByLabelText(/CMS HTML/u), { target: { files: [file] } });
  const button = await screen.findByRole("button", { name: "上傳並核對資料" }); await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
}
function chooseDecisions() {
  fireEvent.change(screen.getByLabelText("機構個案編號（必填）"), { target: { value: "SYNTHETIC-01" } });
  for (const label of ["姓名", "身分識別"]) { const article = screen.getByRole("heading", { name: label }).closest("article")!;
    fireEvent.change(within(article).getByLabelText("這一欄如何處理"), { target: { value: "use_source" } }); }
  fireEvent.click(screen.getByRole("checkbox"));
}
function renderCms(current: IntakeSnapshot | null = null) {
  const callbacks = { onSaved: vi.fn().mockResolvedValue(undefined), onManual: vi.fn(), onDirty: vi.fn() };
  const props = { context, current, canImport: true, canApprove: true, archiveConfigured: true, demo: false, ...callbacks };
  return { ...render(<CmsIntakeStep {...props} />), props, ...callbacks };
}
async function showPreview(current: IntakeSnapshot | null = null) {
  const receipt = await stagingFixture(), data = previewFixture(current);
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(success(receipt))).mockResolvedValueOnce(Response.json(success(data)));
  vi.stubGlobal("fetch", fetcher); const view = renderCms(current); await selectAndUpload();
  await screen.findByRole("heading", { name: "逐欄核對後，才會寫入個案資料" });
  await waitFor(() => expect(screen.getByLabelText("機構個案編號（必填）")).toBeEnabled());
  return { ...view, fetcher, data };
}
beforeEach(async () => {
  vi.resetModules(); vi.stubGlobal("crypto", webcrypto);
  Object.defineProperty(File.prototype, "arrayBuffer", { configurable: true, value(this: File) {
    return new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(this); });
  } });
  journal = await import("@/lib/imports/upload-pending"); uploadClient = await import("@/lib/imports/upload-client");
  journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(context));
  IntakeProfileForm = (await import("./intake-profile-form")).IntakeProfileForm;
  CmsIntakeStep = (await import("./cms-intake-step")).CmsIntakeStep;
  IntakeWorkspace = (await import("./intake-workspace")).IntakeWorkspace;
});
afterEach(() => { cleanup(); journal.clearCmsUploadOnLogout(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("intake usability and truthful writes", () => {
  it("does not offer unknown-case CMS staging to assigned-only staff", () => {
    const context = { organizationId: id, organizationName: "合成機構", branchId: id, branchName: "合成分支", userId: id, displayName: "合成收案人員", roles: ["nurse" as const], scopes: ["clients.read", "clients.manage", "clients.demographics.read", "imports.manage", "imports.approve"], assuranceLevel: "aal1" as const, recentAal2At: null, demo: false };
    journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(context));
    const { rerender } = render(<IntakeWorkspace context={context} clients={[]} initialSnapshot={null} loadError={false} today="2026-09-14" archiveConfigured />);
    expect(screen.getByLabelText(/CMS HTML/)).toBeDisabled();
    expect(screen.getByText(/一般建檔、CMS 核對與每週安排/)).toHaveTextContent("不另要求驗證器");
    const approved = { ...context, scopes: [...context.scopes, "clients.view_all"] };
    act(() => journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(approved)));
    rerender(<IntakeWorkspace context={approved} clients={[]} initialSnapshot={null} loadError={false} today="2026-09-14" archiveConfigured />);
    expect(screen.getByLabelText(/CMS HTML/)).toBeEnabled();
  });
  it("synthetic mode never enables a real file upload or save", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<CmsIntakeStep context={{ ...context, demo: true }} current={null} canImport canApprove demo onSaved={vi.fn()} onManual={vi.fn()} onDirty={vi.fn()} />);
    expect(screen.getByLabelText(/CMS HTML/)).toBeDisabled(); expect(screen.getByRole("button", { name: "上傳並核對資料" })).toBeDisabled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("explains missing CMS archive configuration before file selection and leaves manual intake available", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const onManual = vi.fn();
    render(<CmsIntakeStep context={context} current={null} canImport canApprove demo={false} archiveConfigured={false} onSaved={vi.fn()} onManual={onManual} onDirty={vi.fn()} />);
    expect(screen.getByText("HTML 匯入暫停；請保留原檔，可先手動建檔。")).toBeVisible();
    expect(screen.getByLabelText(/CMS HTML/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "上傳並核對資料" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "沒有 CMS 檔？手動建檔" }));
    expect(onManual).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it("labels missing information as missing, not complete", () => {
    render(<IntakeProfileForm initial={null} canManage demo={false} today="2026-09-14" onSaved={vi.fn()} onDirty={vi.fn()} />);
    expect(screen.getByText(/目前仍待核對/)).toHaveTextContent("可聯繫的關係人"); expect(screen.getByLabelText("告知同意狀態")).toHaveValue("pending");
    fireEvent.click(screen.getByRole("button", { name: "＋新增聯絡人" })); expect(screen.getByLabelText("聯絡人姓名")).toBeVisible();
  });
  it("retains fields and idempotency key when an uncertain request is retried", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("連線中斷"))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { clientId: id, persisted: true } }));
    vi.stubGlobal("fetch", fetch); const onSaved = vi.fn().mockResolvedValue(undefined);
    render(<IntakeProfileForm initial={null} canManage demo={false} today="2026-09-14" onSaved={onSaved} onDirty={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("姓名／顯示稱呼（必填）"), { target: { value: "合成測試個案" } }); fireEvent.change(screen.getByLabelText("機構個案編號（必填）"), { target: { value: "TEST-001" } });
    fireEvent.click(screen.getByRole("button", { name: "建立待收案個案" })); expect(await screen.findByRole("alert")).toHaveTextContent("連線中斷");
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveValue("合成測試個案");
    fireEvent.click(screen.getByRole("button", { name: "建立待收案個案" })); await waitFor(() => expect(onSaved).toHaveBeenCalledWith(id));
    expect(JSON.parse(fetch.mock.calls[0][1].body).idempotency_key).toBe(JSON.parse(fetch.mock.calls[1][1].body).idempotency_key);
  });
  it("central identity stays locked while local contact fields remain editable", () => {
    render(<IntakeProfileForm initial={{ clientId: id, profileVersion: 1, clientRowVersion: 1, pending: true, profile: { ...emptyIntakeProfile, displayName: "合成中央個案", clientCode: "TEST-001" }, fieldAuthority: { displayName: "central" }, sourceBatchId: id }} canManage demo={false} today="2026-09-14" onSaved={vi.fn()} onDirty={vi.fn()} />);
    expect(screen.getByLabelText(/姓名／顯示稱呼/)).toBeDisabled(); expect(screen.getByLabelText("個案電話")).toBeEnabled();
  });
  it("does not open another case from a mismatched update receipt", async () => {
    const other = "c1600000-0000-4000-8000-000000000002";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ status: "ok", data: { clientId: other, persisted: true } })));
    const onSaved = vi.fn(); const onDirty = vi.fn();
    render(<IntakeProfileForm initial={{ clientId: id, profileVersion: 1, clientRowVersion: 1, pending: true, profile: { ...emptyIntakeProfile, displayName: "合成個案甲", clientCode: "TEST-001" }, fieldAuthority: {}, sourceBatchId: null }} canManage demo={false} today="2026-09-14" onSaved={onSaved} onDirty={onDirty} />);
    fireEvent.change(screen.getByLabelText("個案電話"), { target: { value: "合成電話備註" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存基本資料" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("儲存回條與目前個案不一致");
    expect(onSaved).not.toHaveBeenCalled(); expect(onDirty).toHaveBeenLastCalledWith(true);
  });
  it("locates nested contact and consent errors while preserving Traditional Chinese input", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<IntakeProfileForm initial={null} canManage demo={false} today="2026-09-14" onSaved={vi.fn()} onDirty={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("姓名／顯示稱呼（必填）"), { target: { value: "合成繁體中文個案" } });
    fireEvent.change(screen.getByLabelText("機構個案編號（必填）"), { target: { value: "測試-甲" } });
    fireEvent.click(screen.getByRole("button", { name: "＋新增聯絡人" }));
    fireEvent.change(screen.getByLabelText("聯絡人姓名"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("告知同意狀態"), { target: { value: "confirmed" } });
    fireEvent.submit(screen.getByRole("button", { name: "建立待收案個案" }).closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent("聯絡人 1：姓名");
    expect(screen.getByLabelText("聯絡人姓名")).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(screen.getByLabelText("聯絡人姓名")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "同意確認日期" }));
    expect(screen.getByLabelText("確認日期")).toHaveFocus();
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveValue("合成繁體中文個案");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a valid-shaped snapshot belonging to another selected client", async () => {
    const other = "c1600000-0000-4000-8000-000000000002";
    const snapshot = { clientId: id, profileVersion: 1, clientRowVersion: 1, pending: true, profile: { ...emptyIntakeProfile, displayName: "其他個案禁止顯示", clientCode: "SYNTHETIC-01" }, fieldAuthority: {}, sourceBatchId: null };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "ok", data: snapshot })));
    render(<IntakeWorkspace context={{ organizationId: id, organizationName: "合成機構", branchId: other, branchName: "合成分支", userId: id, displayName: "合成管理員", roles: ["nurse"], scopes: [], assuranceLevel: "aal2", recentAal2At: null, demo: false }} clients={[{ id: other, clientCode: "TEST-02", displayName: "選取的合成個案" }]} initialSnapshot={null} loadError={false} today="2026-09-14" />);
    fireEvent.change(screen.getByLabelText("個案"), { target: { value: other } });
    expect(await screen.findByRole("alert")).toHaveTextContent("讀回資料與所選個案不一致");
    expect(screen.queryByDisplayValue("其他個案禁止顯示")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2\s*基本資料/ })).toBeDisabled();
  });
  it("requires explicit CMS decisions, then sends IDs only and reads the real client", async () => {
    const preview = previewFixture(), receipt = await stagingFixture();
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(success(receipt)))
      .mockResolvedValueOnce(Response.json(success(preview)))
      .mockResolvedValueOnce(Response.json(success({ clientId: id, persisted: true, formallyImported: true })));
    vi.stubGlobal("fetch", fetch); const onSaved = vi.fn().mockResolvedValue(undefined);
    render(<CmsIntakeStep context={context} current={null} canImport canApprove archiveConfigured demo={false} onSaved={onSaved} onManual={vi.fn()} onDirty={vi.fn()} />);
    await selectAndUpload();
    const confirm = await screen.findByRole("button", { name: "確認建立待收案個案" }); expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("機構個案編號（必填）"), { target: { value: "SYNTHETIC-01" } });
    for (const label of ["姓名", "身分識別"]) { const article = screen.getByRole("heading", { name: label }).closest("article")!; fireEvent.change(within(article).getByLabelText("這一欄如何處理"), { target: { value: "use_source" } }); }
    expect(confirm).toBeDisabled(); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(confirm);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(id));
    const submitted = JSON.parse(fetch.mock.calls[2][1].body);
    expect(submitted.decisions).toEqual([{ target: "displayName", fieldId: "field-0", choice: "use_source" }, { target: "identityNumber", fieldId: "field-1", choice: "use_source" }]);
    expect(submitted).not.toHaveProperty("profile"); expect(submitted).not.toHaveProperty("parsedPayload");
  });
  it("accepts enriched duplicate upload ACK and correlates source payload before exposing decisions", async () => {
    const receipt = await stagingFixture(); const fetcher = vi.fn().mockResolvedValueOnce(Response.json(success({ reservation_id: id,
      status: "completed", recovered: true, file_sha256: receipt.file_sha256, payload_sha256: receipt.payload_sha256, mapping_version: receipt.mapping_version })))
      .mockResolvedValueOnce(Response.json(success(previewFixture())));
    vi.stubGlobal("fetch", fetcher); renderCms(); await selectAndUpload();
    expect(await screen.findByRole("heading", { name: "姓名" })).toBeVisible();
    expect(fetcher.mock.calls[1]![0]).toBe(`/api/client-intake/imports?batch=${id}`);
    expect(journal.hasCmsUploadOperation()).toBe(false); expect(await screen.findByRole("button", { name: "確認建立待收案個案" })).toBeDisabled();
  });
  it("unknown upload replies permit only the original key after an explicit observational lookup", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("PRIVATE_UNKNOWN_UPLOAD"))
      .mockResolvedValueOnce(Response.json(success({ found: false, operation: null }))).mockRejectedValueOnce(new Error("PRIVATE_UNKNOWN_RETRY"));
    vi.stubGlobal("fetch", fetcher); renderCms(); await selectAndUpload(); await screen.findByRole("alert");
    const scope = journal.cmsUploadScope(context, "routine-intake", null), original = journal.getCmsUploadOperation(scope)!;
    expect(original.phase).toBe("unknown"); expect(screen.getByRole("button", { name: "繼續原上傳" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "確認建立待收案個案" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "確認上傳結果" })); await screen.findByText(/尚未查到原操作/u);
    const retry = screen.getByRole("button", { name: "繼續原上傳" }); expect(retry).toBeEnabled(); fireEvent.click(retry);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3)); await screen.findByRole("alert");
    expect(fetcher.mock.calls[0]![1].headers["idempotency-key"]).toBe(original.key);
    expect(fetcher.mock.calls[1]![0]).toBe("/api/client-intake/imports/operations");
    expect(fetcher.mock.calls[2]![1].headers["idempotency-key"]).toBe(original.key);
    expect(journal.getCmsUploadOperation(scope)!.file).toEqual(original.file); expect(journal.hasCmsUploadOperation()).toBe(true);
  });
  it("authority ABA advances preview epoch and cannot redisplay or approve old parsed source", async () => {
    const test = await showPreview(); chooseDecisions(); const oldApprove = screen.getByRole("button", { name: "確認建立待收案個案" });
    expect(oldApprove).toBeEnabled(); const oldEpoch = journal.getCmsUploadState().epoch;
    const changed = { ...context, userId: other }; act(() => journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(changed)));
    test.rerender(<CmsIntakeStep {...test.props} context={changed} />);
    expect(screen.queryByText(/CMS 來源：合成新個案/u)).not.toBeInTheDocument();
    act(() => journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(context))); test.rerender(<CmsIntakeStep {...test.props} />);
    expect(journal.getCmsUploadState().epoch).toBeGreaterThan(oldEpoch);
    expect(screen.queryByRole("heading", { name: "姓名" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "確認建立待收案個案" })).not.toBeInTheDocument(); fireEvent.click(oldApprove);
    expect(test.fetcher).toHaveBeenCalledTimes(2); expect(test.onSaved).not.toHaveBeenCalled();
  });
  it("a different selected case hides existing preview and cannot approve through an old control", async () => {
    const test = await showPreview(); chooseDecisions(); const oldApprove = screen.getByRole("button", { name: "確認建立待收案個案" });
    const selected: IntakeSnapshot = { clientId: other, profileVersion: 1, clientRowVersion: 1, pending: true,
      profile: { ...emptyIntakeProfile, displayName: "目前選定的合成個案", clientCode: "OTHER" }, fieldAuthority: {}, sourceBatchId: null };
    test.rerender(<CmsIntakeStep {...test.props} current={selected} />);
    expect(screen.queryByText(/CMS 來源：合成新個案/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "確認更新個案資料" })).not.toBeInTheDocument(); fireEvent.click(oldApprove);
    expect(test.fetcher).toHaveBeenCalledTimes(2); expect(test.onSaved).not.toHaveBeenCalled();
  });
  it.each(["client", "payload"])("uncorrelated preview %s never exposes fields or approval", async kind => {
    const receipt = await stagingFixture(); const wrongClient: IntakeSnapshot = { clientId: other, profileVersion: 1, clientRowVersion: 1, pending: true,
      profile: { ...emptyIntakeProfile, displayName: "其他個案禁止顯示", clientCode: "OTHER" }, fieldAuthority: {}, sourceBatchId: null };
    const data = previewFixture(kind === "client" ? wrongClient : null); if (kind === "payload") data.payloadSha256 = "d".repeat(64);
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(success(receipt))).mockResolvedValueOnce(Response.json(success(data)));
    vi.stubGlobal("fetch", fetcher); const test = renderCms(); await selectAndUpload(); await screen.findByRole("alert");
    expect(screen.queryByText("其他個案禁止顯示")).not.toBeInTheDocument(); expect(screen.queryByRole("heading", { name: "姓名" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "確認建立待收案個案" })).not.toBeInTheDocument(); expect(test.onSaved).not.toHaveBeenCalled();
    expect(journal.hasCmsUploadOperation()).toBe(true); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("logout hides loaded preview and observer cannot revive it under old server props", async () => {
    const test = await showPreview(); chooseDecisions(); act(() => journal.clearCmsUploadOnLogout());
    expect(screen.queryByRole("heading", { name: "姓名" })).not.toBeInTheDocument();
    act(() => journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(context))); test.rerender(<CmsIntakeStep {...test.props} />);
    expect(screen.queryByRole("button", { name: "確認建立待收案個案" })).not.toBeInTheDocument(); expect(test.fetcher).toHaveBeenCalledTimes(2);
    expect(test.onSaved).not.toHaveBeenCalled();
  });
  it("pending approval ACK cannot open an old case after an authority ABA", async () => {
    const test = await showPreview(); chooseDecisions(); let reply!: (response: Response) => void;
    test.fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { reply = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "確認建立待收案個案" })); await waitFor(() => expect(test.fetcher).toHaveBeenCalledTimes(3));
    const changed = { ...context, userId: other }; act(() => journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(changed)));
    test.rerender(<CmsIntakeStep {...test.props} context={changed} />);
    act(() => journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(context))); test.rerender(<CmsIntakeStep {...test.props} />);
    await act(async () => reply(Response.json(success({ clientId: id, persisted: true, formallyImported: true }))));
    expect(test.onSaved).not.toHaveBeenCalled(); expect(screen.queryByText(/個案資料已正式存入/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "姓名" })).not.toBeInTheDocument(); expect(test.fetcher).toHaveBeenCalledTimes(3);
  });
  it("pending approval failure cannot display the old authority response after an ABA", async () => {
    const test = await showPreview(); chooseDecisions(); let reply!: (response: Response) => void;
    test.fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { reply = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "確認建立待收案個案" })); await waitFor(() => expect(test.fetcher).toHaveBeenCalledTimes(3));
    const changed = { ...context, userId: other }; act(() => journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(changed)));
    test.rerender(<CmsIntakeStep {...test.props} context={changed} />);
    act(() => journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(context))); test.rerender(<CmsIntakeStep {...test.props} />);
    await act(async () => reply(Response.json({ requestId: other, status: "error", data: null,
      errors: [{ code: "FORBIDDEN", message: "OLD_AUTHORITY_PRIVATE_FAILURE" }] }, { status: 403 })));
    expect(screen.queryByText(/OLD_AUTHORITY_PRIVATE_FAILURE/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(test.onSaved).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "姓名" })).not.toBeInTheDocument(); expect(test.fetcher).toHaveBeenCalledTimes(3);
  });
  it("pending source preview is cancelled across scope ABA without showing parsed data or approving", async () => {
    const receipt = await stagingFixture(); let reply!: (response: Response) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(success(receipt))).mockImplementationOnce(() => new Promise<Response>(resolve => { reply = resolve; }));
    vi.stubGlobal("fetch", fetcher); const test = renderCms(); await selectAndUpload(); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const changed = { ...context, branchId: other }; act(() => journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(changed)));
    test.rerender(<CmsIntakeStep {...test.props} context={changed} />);
    act(() => journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(context))); test.rerender(<CmsIntakeStep {...test.props} />);
    await act(async () => reply(Response.json(success(previewFixture()))));
    expect(screen.queryByRole("heading", { name: "姓名" })).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "確認建立待收案個案" })).not.toBeInTheDocument();
    expect(test.onSaved).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(2); expect(journal.hasCmsUploadOperation()).toBe(true);
  });
  it("attempting a different invalid file clears old source decisions and cannot approve the previous batch", async () => {
    const test = await showPreview(); chooseDecisions();
    const oldApprove = screen.getByRole("button", { name: "確認建立待收案個案" }); expect(oldApprove).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/CMS HTML/u), { target: { files: [new File(["invalid new file"], "different.txt", { type: "text/plain" })] } });
    await screen.findByRole("alert");
    expect(screen.queryByText(/CMS 來源：合成新個案/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "姓名" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "確認建立待收案個案" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/CMS HTML/u)).toHaveValue(""); fireEvent.click(oldApprove);
    expect(test.fetcher).toHaveBeenCalledTimes(2); expect(test.onSaved).not.toHaveBeenCalled();
  });
  it("cancelling the file picker is not a new source intention and retains the valid preview", async () => {
    const test = await showPreview(); chooseDecisions();
    fireEvent.change(screen.getByLabelText(/CMS HTML/u), { target: { files: [] } });
    expect(screen.getByText(/CMS 來源：合成新個案/u)).toBeVisible();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("button", { name: "確認建立待收案個案" })).toBeEnabled();
    expect(test.fetcher).toHaveBeenCalledTimes(2); expect(test.onSaved).not.toHaveBeenCalled();
  });
  it("keeps weekly drafts across steps and asks before switching the client", async () => {
    vi.stubGlobal("fetch", vi.fn()); const confirm = vi.fn().mockReturnValue(false); vi.stubGlobal("confirm", confirm);
    const other = "c1600000-0000-4000-8000-000000000002";
    render(<IntakeWorkspace context={{ organizationId: id, organizationName: "合成機構", branchId: other, branchName: "合成分支", userId: id, displayName: "合成管理員", roles: ["nurse"], scopes: [], assuranceLevel: "aal2", recentAal2At: null, demo: true }} clients={[{ id, clientCode: "TEST-01", displayName: "合成個案甲" }, { id: other, clientCode: "TEST-02", displayName: "合成個案乙" }]} initialSnapshot={{ clientId: id, profileVersion: 1, clientRowVersion: 1, pending: true, profile: { ...emptyIntakeProfile, displayName: "合成個案甲", clientCode: "TEST-01" }, fieldAuthority: {}, sourceBatchId: null }} loadError={false} today="2026-09-14" />);
    fireEvent.click(screen.getByRole("button", { name: /3\s*每週到站與接送/ }));
    fireEvent.click(await screen.findByLabelText("週一到站"));
    fireEvent.click(screen.getByRole("button", { name: /2\s*基本資料/ }));
    expect(screen.getByRole("heading", { name: "核對個案基本資料" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("個案"), { target: { value: other } });
    expect(confirm).toHaveBeenCalled(); expect(screen.getByLabelText("個案")).toHaveValue(id);
    fireEvent.click(screen.getByRole("button", { name: /3\s*每週到站與接送/ })); expect(screen.getByLabelText("週一到站")).toBeChecked();
  });
});
