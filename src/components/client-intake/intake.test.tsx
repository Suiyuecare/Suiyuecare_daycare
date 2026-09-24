// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntakeProfileForm } from "./intake-profile-form";
import { CmsIntakeStep } from "./cms-intake-step";
import { emptyIntakeProfile } from "@/lib/client-intake/model";
import { IntakeWorkspace } from "./intake-workspace";
const id = "c1600000-0000-4000-8000-000000000001";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("intake usability and truthful writes", () => {
  it("does not offer unknown-case CMS staging to assigned-only staff", () => {
    const context = { organizationId: id, organizationName: "合成機構", branchId: id, branchName: "合成分支", userId: id, displayName: "合成收案人員", roles: ["nurse" as const], scopes: ["clients.read", "clients.manage", "clients.demographics.read", "imports.manage", "imports.approve"], assuranceLevel: "aal1" as const, recentAal2At: null, demo: false };
    const { rerender } = render(<IntakeWorkspace context={context} clients={[]} initialSnapshot={null} loadError={false} today="2026-09-14" archiveConfigured />);
    expect(screen.getByLabelText(/CMS HTML/)).toBeDisabled();
    expect(screen.getByText(/一般建檔、CMS 核對與每週安排/)).toHaveTextContent("不另要求驗證器");
    rerender(<IntakeWorkspace context={{ ...context, scopes: [...context.scopes, "clients.view_all"] }} clients={[]} initialSnapshot={null} loadError={false} today="2026-09-14" archiveConfigured />);
    expect(screen.getByLabelText(/CMS HTML/)).toBeEnabled();
  });
  it("synthetic mode never enables a real file upload or save", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<CmsIntakeStep current={null} canImport canApprove demo onSaved={vi.fn()} onManual={vi.fn()} onDirty={vi.fn()} />);
    expect(screen.getByLabelText(/CMS HTML/)).toBeDisabled(); expect(screen.getByRole("button", { name: "上傳並核對資料" })).toBeDisabled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("explains missing CMS archive configuration before file selection and leaves manual intake available", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const onManual = vi.fn();
    render(<CmsIntakeStep current={null} canImport canApprove demo={false} archiveConfigured={false} onSaved={vi.fn()} onManual={onManual} onDirty={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("HTML 匯入暫停；請保留原檔，可先手動建檔");
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
    fireEvent.change(screen.getByLabelText("目前處理的個案"), { target: { value: other } });
    expect(await screen.findByRole("alert")).toHaveTextContent("讀回資料與所選個案不一致");
    expect(screen.queryByDisplayValue("其他個案禁止顯示")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2\s*基本資料/ })).toBeDisabled();
  });
  it("requires explicit CMS decisions, then sends IDs only and reads the real client", async () => {
    const fields = [["displayName", "姓名", "合成新個案"], ["identityNumber", "身分識別", "X123456789"]].map(([target, label, value], i) => ({ id: `field-${i}`, intakeTarget: target, normalizedValue: value, rawValue: value, warnings: [], source: { sectionCode: "CLIENT_BASIC", sectionTitle: "合成基本資料", label, parentPath: "CLIENT_BASIC/table/tr" } }));
    const preview = { batchId: id, payloadSha256: "a".repeat(64), mappingVersion: "central-care-plan-html@1", fields, sections: [{ code: "CLIENT_BASIC", title: "合成基本資料" }], warnings: [], conflicts: [], current: null, imported: false, importReceipt: null };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: "ok", data: { reservation_id: id, status: "completed" } }))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: preview }))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { clientId: id, persisted: true, formallyImported: true } }));
    vi.stubGlobal("fetch", fetch); const onSaved = vi.fn().mockResolvedValue(undefined);
    render(<CmsIntakeStep current={null} canImport canApprove archiveConfigured demo={false} onSaved={onSaved} onManual={vi.fn()} onDirty={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/CMS HTML/), { target: { files: [new File(["<h5>合成資料</h5>"], "synthetic.html", { type: "text/html" })] } });
    fireEvent.click(screen.getByRole("button", { name: "上傳並核對資料" }));
    const confirm = await screen.findByRole("button", { name: "確認建立待收案個案" }); expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("機構個案編號（必填）"), { target: { value: "SYNTHETIC-01" } });
    for (const label of ["姓名", "身分識別"]) { const article = screen.getByRole("heading", { name: label }).closest("article")!; fireEvent.change(within(article).getByLabelText("這一欄如何處理"), { target: { value: "use_source" } }); }
    expect(confirm).toBeDisabled(); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(confirm);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(id));
    const submitted = JSON.parse(fetch.mock.calls[2][1].body);
    expect(submitted.decisions).toEqual([{ target: "displayName", fieldId: "field-0", choice: "use_source" }, { target: "identityNumber", fieldId: "field-1", choice: "use_source" }]);
    expect(submitted).not.toHaveProperty("profile"); expect(submitted).not.toHaveProperty("parsedPayload");
  });
  it("keeps weekly drafts across steps and asks before switching the client", async () => {
    vi.stubGlobal("fetch", vi.fn()); const confirm = vi.fn().mockReturnValue(false); vi.stubGlobal("confirm", confirm);
    const other = "c1600000-0000-4000-8000-000000000002";
    render(<IntakeWorkspace context={{ organizationId: id, organizationName: "合成機構", branchId: other, branchName: "合成分支", userId: id, displayName: "合成管理員", roles: ["nurse"], scopes: [], assuranceLevel: "aal2", recentAal2At: null, demo: true }} clients={[{ id, clientCode: "TEST-01", displayName: "合成個案甲" }, { id: other, clientCode: "TEST-02", displayName: "合成個案乙" }]} initialSnapshot={{ clientId: id, profileVersion: 1, clientRowVersion: 1, pending: true, profile: { ...emptyIntakeProfile, displayName: "合成個案甲", clientCode: "TEST-01" }, fieldAuthority: {}, sourceBatchId: null }} loadError={false} today="2026-09-14" />);
    fireEvent.click(screen.getByRole("button", { name: /3\s*每週到站與接送/ }));
    fireEvent.click(await screen.findByLabelText("週一到站"));
    fireEvent.click(screen.getByRole("button", { name: /2\s*基本資料/ }));
    expect(screen.getByRole("heading", { name: "核對個案基本資料" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("目前處理的個案"), { target: { value: other } });
    expect(confirm).toHaveBeenCalled(); expect(screen.getByLabelText("目前處理的個案")).toHaveValue(id);
    fireEvent.click(screen.getByRole("button", { name: /3\s*每週到站與接送/ })); expect(screen.getByLabelText("週一到站")).toBeChecked();
  });
});
