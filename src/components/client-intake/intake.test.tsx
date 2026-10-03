// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
const routerReplace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", async (importOriginal) => ({ ...await importOriginal<typeof import("next/navigation")>(), useRouter: () => ({ replace: routerReplace }) }));
import { IntakeProfileForm } from "./intake-profile-form";
import { CmsIntakeStep } from "./cms-intake-step";
import { emptyIntakeProfile } from "@/lib/client-intake/model";
import { IntakeWorkspace } from "./intake-workspace";
const id = "c1600000-0000-4000-8000-000000000001";
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterAll(() => {
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); routerReplace.mockReset(); });
describe("intake usability and truthful writes", () => {
  const newCaseContext = { organizationId: id, organizationName: "合成機構", branchId: id, branchName: "合成分支", userId: id, displayName: "合成收案人員", roles: ["nurse" as const], scopes: ["clients.read", "clients.demographics.read", "clients.manage", "clients.view_all"], assuranceLevel: "aal1" as const, recentAal2At: null, demo: false };
  it.each([
    { reason: "封存未配置", archiveConfigured: false, scopes: [...newCaseContext.scopes, "imports.manage"] },
    { reason: "沒有匯入權限", archiveConfigured: true, scopes: newCaseContext.scopes },
    { reason: "只有匯入但沒有核准權限", archiveConfigured: true, scopes: [...newCaseContext.scopes, "imports.manage"] },
  ])("$reason 時直接提供手動建檔", ({ archiveConfigured, scopes }) => {
    render(<IntakeWorkspace context={{ ...newCaseContext, scopes }} clients={[]} initialSnapshot={null} loadError={false} today="2026-09-14" archiveConfigured={archiveConfigured} />);
    expect(screen.getByRole("heading", { name: "手動建立待收案個案" })).toBeVisible();
    expect(screen.getByRole("button", { name: "建立待收案個案" })).toBeEnabled();
    expect(screen.getByRole("navigation", { name: "收案流程" }).querySelector("button[aria-expanded=false]")).toHaveTextContent("第 2／5 步：基本資料");
    expect(screen.getByRole("status")).toHaveTextContent("CMS 匯入需由具權限人員在服務就緒後核對");
  });
  it("keeps the CMS route available to an authorized new-case importer", () => {
    render(<IntakeWorkspace context={{ ...newCaseContext, scopes: [...newCaseContext.scopes, "imports.manage", "imports.approve"] }} clients={[]} initialSnapshot={null} loadError={false} today="2026-09-14" archiveConfigured />);
    expect(screen.getByRole("heading", { name: "匯入 CMS 資料" })).toBeVisible();
    expect(screen.getByLabelText(/CMS HTML/)).toBeEnabled();
    expect(screen.getByRole("button", { name: "上傳並核對資料" })).toBeDisabled();
  });
  it("returns from an existing case to a blank manual form when CMS is unavailable", () => {
    const snapshot = { clientId: id, profileVersion: 1, clientRowVersion: 1, pending: true, profile: { ...emptyIntakeProfile, displayName: "合成既有個案", clientCode: "TEST-001" }, fieldAuthority: {}, sourceBatchId: null };
    render(<IntakeWorkspace context={newCaseContext} clients={[{ id, displayName: "合成既有個案", clientCode: "TEST-001" }]} initialSnapshot={snapshot} loadError={false} today="2026-09-14" archiveConfigured={false} />);
    fireEvent.change(screen.getByLabelText("目前處理的個案"), { target: { value: "" } });
    expect(screen.getByRole("heading", { name: "手動建立待收案個案" })).toBeVisible();
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveValue("");
    expect(screen.getByRole("button", { name: "建立待收案個案" })).toBeEnabled();
  });
  it("keeps staging available without implying a cross-person handoff", () => {
    render(<CmsIntakeStep current={null} canImport canApprove={false} archiveConfigured demo={false} onSaved={vi.fn()} onManual={vi.fn()} onDirty={vi.fn()} />);
    expect(screen.getByLabelText(/CMS HTML/)).toBeEnabled();
    expect(screen.getByText(/您可在此分頁上傳並預覽，但不會建立跨人交接待辦/)).toBeVisible();
    expect(screen.getByText(/正式建檔請由具匯入與核准權限的人員自行選檔並完成逐欄核對/)).toBeVisible();
    expect(screen.getByRole("button", { name: "手動建立待收案個案" })).toBeEnabled();
  });
  it.each(["clients.read", "clients.demographics.read", "clients.manage", "clients.view_all"])("explains missing %s creation scope without blaming CMS permission", (missingScope) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const scopes = [...newCaseContext.scopes, "imports.manage", "imports.approve"].filter((scope) => scope !== missingScope);
    render(<IntakeWorkspace context={{ ...newCaseContext, scopes }} clients={[]} initialSnapshot={null} loadError={false} today="2026-09-14" archiveConfigured />);
    expect(screen.getByLabelText(/CMS HTML/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "手動建立待收案個案" })).toBeDisabled();
    expect(screen.getAllByText(/此帳號沒有建立新個案的權限；請選擇已授權的既有個案/)[0]).toBeVisible();
    expect(screen.queryByText(/您尚未取得 CMS 匯入權限/)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("names a genuine missing CMS import scope while leaving manual creation available", () => {
    render(<IntakeWorkspace context={newCaseContext} clients={[]} initialSnapshot={null} loadError={false} today="2026-09-14" archiveConfigured />);
    expect(screen.getByRole("button", { name: "建立待收案個案" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /1\s*匯入與建檔/ }));
    expect(screen.getByLabelText(/CMS HTML/)).toBeDisabled();
    expect(screen.getByText(/您尚未取得 CMS 匯入權限/)).toBeVisible();
  });
  it("keeps mobile progress choices and the full permission explanation reachable", () => {
    render(<IntakeWorkspace context={newCaseContext} clients={[]} initialSnapshot={null} loadError={false} today="2026-09-14" archiveConfigured={false} />);
    const progress = screen.getByRole("button", { name: /第 2／5 步：基本資料/ });
    expect(progress).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(progress);
    expect(progress).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: /1\s*匯入與建檔/ }));
    expect(progress).toHaveAttribute("aria-expanded", "false");
    expect(progress).toHaveFocus();
    expect(progress).toHaveTextContent("第 1／5 步：匯入與建檔");
    const details = screen.getByText("資料與權限說明").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("資料與權限說明"));
    expect(details).toHaveAttribute("open");
    expect(details).toHaveTextContent("此頁不會自動核准收案");
  });
  it("guards a real history Back, retains a canceled draft, and clears it before Forward after discard", async () => {
    window.history.replaceState({ prior: true }, "", "/app/staff/workspace/case-center");
    window.history.pushState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { synthetic: true } }, "", "/app/client-intake");
    const confirm = vi.spyOn(window, "confirm");
    render(<IntakeWorkspace context={newCaseContext} clients={[]} initialSnapshot={null} loadError={false} today="2026-09-14" archiveConfigured={false} />);
    fireEvent.change(screen.getByLabelText("姓名／顯示稱呼（必填）"), { target: { value: "合成未儲存名字" } });
    await waitFor(() => expect(window.history.state.__daycareIntakeUnsavedGuard).toEqual(expect.any(String)));
    const marker = window.history.state.__daycareIntakeUnsavedGuard;
    expect(window.history.state.__NA).toBe(true);
    expect(JSON.stringify(window.history.state)).not.toContain("合成未儲存名字");
    window.history.back();
    const leave = await screen.findByRole("alertdialog", { name: "放棄未儲存的收案資料？" });
    expect(leave).toBeVisible();
    expect(screen.getByRole("button", { name: "繼續填寫" })).toHaveFocus();
    expect(window.location.pathname).toBe("/app/client-intake");
    expect(window.history.state.__daycareIntakeUnsavedGuard).toBe(marker);
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveValue("合成未儲存名字");
    fireEvent.click(screen.getByRole("button", { name: "繼續填寫" }));
    await waitFor(() => expect(leave).not.toHaveAttribute("open"));
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveValue("合成未儲存名字");
    await waitFor(() => expect(screen.getByLabelText("目前處理的個案")).toHaveFocus());
    window.history.back();
    await waitFor(() => expect(leave).toHaveAttribute("open"));
    fireEvent.click(screen.getByRole("button", { name: "放棄輸入並離開" }));
    await waitFor(() => expect(window.location.pathname).toBe("/app/staff/workspace/case-center"));
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveValue("");
    window.history.forward();
    await waitFor(() => expect(window.location.pathname).toBe("/app/client-intake"));
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveValue("");
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
  it("returns to the case center when a bookmarked intake page has no prior entry", async () => {
    window.history.replaceState({ __NA: true }, "", "/app/client-intake");
    vi.spyOn(window.history, "length", "get").mockReturnValue(1);
    const go = vi.spyOn(window.history, "go");
    render(<IntakeWorkspace context={newCaseContext} clients={[]} initialSnapshot={null} loadError={false} today="2026-09-14" archiveConfigured={false} />);
    fireEvent.change(screen.getByLabelText("姓名／顯示稱呼（必填）"), { target: { value: "尚未儲存" } });
    await waitFor(() => expect(window.history.state.__daycareIntakeUnsavedGuard).toEqual(expect.any(String)));
    window.history.back();
    const leave = await screen.findByRole("alertdialog", { name: "放棄未儲存的收案資料？" });
    fireEvent.click(screen.getByRole("button", { name: "放棄輸入並離開" }));
    await waitFor(() => expect(leave).not.toHaveAttribute("open"));
    expect(routerReplace).toHaveBeenCalledExactlyOnceWith("/app/staff/workspace/case-center");
    expect(go).not.toHaveBeenCalled();
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveValue("");
  });
  it.each(["visible", "hidden"] as const)("uses a safe destination when only Forward entries exist and the tab is %s", async (visibilityState) => {
    window.history.replaceState({ __NA: true }, "", "/app/client-intake");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue(visibilityState);
    vi.spyOn(window.history, "length", "get").mockReturnValue(2);
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
    render(<IntakeWorkspace context={newCaseContext} clients={[]} initialSnapshot={null} loadError={false} today="2026-09-14" archiveConfigured={false} />);
    fireEvent.change(screen.getByLabelText("姓名／顯示稱呼（必填）"), { target: { value: "前進紀錄不是上一頁" } });
    await waitFor(() => expect(window.history.state.__daycareIntakeUnsavedGuard).toEqual(expect.any(String)));
    window.history.back();
    await screen.findByRole("alertdialog", { name: "放棄未儲存的收案資料？" });
    fireEvent.click(screen.getByRole("button", { name: "放棄輸入並離開" }));
    expect(go).toHaveBeenCalledWith(-2);
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith("/app/staff/workspace/case-center"), { timeout: 2000 });
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveValue("");
  });
  it("replaces the sentinel when an internal link is confirmed, without retaining the draft", async () => {
    window.history.replaceState({ __NA: true }, "", "/app/client-intake");
    const confirm = vi.spyOn(window, "confirm");
    render(<IntakeWorkspace context={newCaseContext} clients={[]} initialSnapshot={null} loadError={false} today="2026-09-14" archiveConfigured={false} />);
    fireEvent.change(screen.getByLabelText("姓名／顯示稱呼（必填）"), { target: { value: "合成未儲存名字" } });
    await waitFor(() => expect(window.history.state.__daycareIntakeUnsavedGuard).toEqual(expect.any(String)));
    fireEvent.click(screen.getByRole("link", { name: "個案中心" }));
    const leave = screen.getByRole("alertdialog", { name: "放棄未儲存的收案資料？" });
    expect(leave).toBeVisible();
    expect(routerReplace).not.toHaveBeenCalled();
    const keepEditing = screen.getByRole("button", { name: "繼續填寫" });
    const discard = screen.getByRole("button", { name: "放棄輸入並離開" });
    discard.focus();
    fireEvent.keyDown(discard, { key: "Tab" });
    expect(keepEditing).toHaveFocus();
    fireEvent.keyDown(keepEditing, { key: "Tab", shiftKey: true });
    expect(discard).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "繼續填寫" }));
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveValue("合成未儲存名字");
    fireEvent.click(screen.getByRole("link", { name: "個案中心" }));
    expect(leave).toHaveAttribute("open");
    leave.dispatchEvent(new Event("close"));
    expect(leave).toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "放棄輸入並離開" }));
    expect(routerReplace).toHaveBeenCalledWith("/app/staff/workspace/case-center");
    expect(routerReplace).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(window.history.state.__daycareIntakeUnsavedGuard).toBeUndefined());
    expect(window.history.state.__NA).toBe(true);
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveValue("");
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
  it("collapses the guard before a saved client changes the URL and preserves Next history state", async () => {
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { synthetic: true } }, "", "/app/client-intake");
    const snapshot = { clientId: id, profileVersion: 1, clientRowVersion: 1, pending: true, profile: { ...emptyIntakeProfile, displayName: "合成已存個案", clientCode: "TEST-001" }, fieldAuthority: {}, sourceBatchId: null };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: "ok", data: { clientId: id, persisted: true } }))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: snapshot }));
    vi.stubGlobal("fetch", fetch);
    render(<IntakeWorkspace context={newCaseContext} clients={[]} initialSnapshot={null} loadError={false} today="2026-09-14" archiveConfigured={false} />);
    fireEvent.change(screen.getByLabelText("姓名／顯示稱呼（必填）"), { target: { value: "合成已存個案" } });
    fireEvent.change(screen.getByLabelText("機構個案編號（必填）"), { target: { value: "TEST-001" } });
    await waitFor(() => expect(window.history.state.__daycareIntakeUnsavedGuard).toEqual(expect.any(String)));
    fireEvent.click(screen.getByRole("button", { name: "建立待收案個案" }));
    await waitFor(() => expect(window.location.search).toBe(`?client=${id}`));
    expect(window.history.state.__NA).toBe(true);
    expect(window.history.state.__PRIVATE_NEXTJS_INTERNALS_TREE).toEqual({ synthetic: true });
    await waitFor(() => expect(window.history.state.__daycareIntakeUnsavedGuard).toBeUndefined());
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not offer unknown-case CMS staging to assigned-only staff", () => {
    const context = { organizationId: id, organizationName: "合成機構", branchId: id, branchName: "合成分支", userId: id, displayName: "合成收案人員", roles: ["nurse" as const], scopes: ["clients.read", "clients.manage", "clients.demographics.read", "imports.manage", "imports.approve"], assuranceLevel: "aal1" as const, recentAal2At: null, demo: false };
    const { rerender } = render(<IntakeWorkspace context={context} clients={[]} initialSnapshot={null} loadError={false} today="2026-09-14" archiveConfigured />);
    expect(screen.getByLabelText(/CMS HTML/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "手動建立待收案個案" })).toBeDisabled();
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
    expect(screen.getByRole("status")).toHaveTextContent("HTML 匯入暫停；請保留原檔。可先手動建檔。");
    expect(screen.getByLabelText(/CMS HTML/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "上傳並核對資料" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "手動建立待收案個案" }));
    expect(onManual).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it("labels missing information as missing, not complete", () => {
    render(<IntakeProfileForm initial={null} canManage demo={false} today="2026-09-14" onSaved={vi.fn()} onDirty={vi.fn()} />);
    expect(screen.getByText(/目前仍待核對/)).toHaveTextContent("可聯繫的關係人"); expect(screen.getByLabelText("告知同意狀態")).toHaveValue("pending");
    fireEvent.click(screen.getByRole("button", { name: "＋新增聯絡人" })); expect(screen.getByLabelText("聯絡人姓名")).toBeVisible();
  });
  it("uses its own validation and focuses the first missing required field", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<IntakeProfileForm initial={null} canManage demo={false} today="2026-09-14" onSaved={vi.fn()} onDirty={vi.fn()} />);
    const submit = screen.getByRole("button", { name: "建立待收案個案" });
    expect(submit.closest("form")).toHaveAttribute("novalidate");
    fireEvent.click(submit);
    expect(screen.getByRole("alert")).toHaveTextContent("姓名／顯示稱呼");
    await waitFor(() => expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveFocus());
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { field: "出生日期", value: "1899-12-31", hint: "出生日期不得早於 1900-01-01" },
    { field: "出生日期", value: "2026-09-15", hint: "出生日期不得晚於台北今日（2026-09-14）" },
    { field: "確認日期", value: "2026-09-15", hint: "同意確認日期不得晚於台北今日（2026-09-14）" },
  ])("rejects $field $value before the request and focuses the date", async ({ field, value, hint }) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<IntakeProfileForm initial={null} canManage demo={false} today="2026-09-14" onSaved={vi.fn()} onDirty={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("姓名／顯示稱呼（必填）"), { target: { value: "合成測試個案" } });
    fireEvent.change(screen.getByLabelText("機構個案編號（必填）"), { target: { value: "TEST-001" } });
    if (field === "確認日期") fireEvent.change(screen.getByLabelText("告知同意狀態"), { target: { value: "confirmed" } });
    fireEvent.change(screen.getByLabelText(field), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "建立待收案個案" }));
    const dateInput = screen.getByLabelText(new RegExp(field));
    expect(screen.getByRole("alert")).toHaveTextContent(hint);
    expect(dateInput).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(dateInput.getAttribute("aria-describedby") ?? "")).toHaveTextContent(hint);
    await waitFor(() => expect(dateInput).toHaveFocus());
    expect(fetch).not.toHaveBeenCalled();
  });
  it("allows the database date boundaries including 1900-01-01 and Taipei today", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ status: "ok", data: { clientId: id, persisted: true } }));
    const onSaved = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetch);
    render(<IntakeProfileForm initial={null} canManage demo={false} today="2026-09-14" onSaved={onSaved} onDirty={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("姓名／顯示稱呼（必填）"), { target: { value: "合成測試個案" } });
    fireEvent.change(screen.getByLabelText("機構個案編號（必填）"), { target: { value: "TEST-001" } });
    fireEvent.change(screen.getByLabelText("出生日期"), { target: { value: "1900-01-01" } });
    fireEvent.change(screen.getByLabelText("告知同意狀態"), { target: { value: "confirmed" } });
    fireEvent.change(screen.getByLabelText("確認日期"), { target: { value: "2026-09-14" } });
    fireEvent.click(screen.getByRole("button", { name: "建立待收案個案" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(id));
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("retains fields and idempotency key when an uncertain request is retried", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("連線中斷"))
      .mockResolvedValueOnce(Response.json({ status: "error", data: null, requestId: "synthetic-rejection", errors: [{ code: "INVALID_REQUEST", message: "暫時拒絕" }] }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { clientId: id, persisted: true } }));
    vi.stubGlobal("fetch", fetch); const onSaved = vi.fn().mockResolvedValue(undefined);
    render(<IntakeProfileForm initial={null} canManage demo={false} today="2026-09-14" onSaved={onSaved} onDirty={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("姓名／顯示稱呼（必填）"), { target: { value: "合成測試個案" } }); fireEvent.change(screen.getByLabelText("機構個案編號（必填）"), { target: { value: "TEST-001" } });
    fireEvent.click(screen.getByRole("button", { name: "建立待收案個案" })); expect(await screen.findByRole("alert")).toHaveTextContent("連線中斷");
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveValue("合成測試個案");
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toBeDisabled();
    expect(screen.getByRole("button", { name: "重試同一次儲存" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "重試同一次儲存" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("暫時拒絕"));
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重試同一次儲存" })); await waitFor(() => expect(onSaved).toHaveBeenCalledWith(id));
    expect(JSON.parse(fetch.mock.calls[0][1].body).idempotency_key).toBe(JSON.parse(fetch.mock.calls[1][1].body).idempotency_key);
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[2][1].body);
  });
  it("releases a first-attempt validated rejection without claiming an ambiguous retry is safe", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ status: "error", data: null, requestId: "synthetic-rejection", errors: [{ code: "INVALID_REQUEST", message: "欄位需修正" }] }, { status: 400 }));
    vi.stubGlobal("fetch", fetch);
    const onUnknown = vi.fn();
    render(<IntakeProfileForm initial={null} canManage demo={false} today="2026-09-14" onSaved={vi.fn()} onDirty={vi.fn()} onUnknown={onUnknown} />);
    fireEvent.change(screen.getByLabelText("姓名／顯示稱呼（必填）"), { target: { value: "合成個案" } });
    fireEvent.change(screen.getByLabelText("機構個案編號（必填）"), { target: { value: "TEST-001" } });
    fireEvent.click(screen.getByRole("button", { name: "建立待收案個案" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("欄位需修正");
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toBeEnabled();
    expect(screen.getByRole("button", { name: "建立待收案個案" })).toBeEnabled();
    expect(onUnknown).not.toHaveBeenCalledWith(true);
  });

  it("blocks changing client after an ambiguous profile write", async () => {
    const other = "c1600000-0000-4000-8000-000000000002";
    const snapshot = { clientId: id, profileVersion: 1, clientRowVersion: 1, pending: true, profile: { ...emptyIntakeProfile, displayName: "合成既有個案", clientCode: "TEST-001" }, fieldAuthority: {}, sourceBatchId: null };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("synthetic network loss")));
    render(<IntakeWorkspace context={newCaseContext} clients={[{ id, displayName: "合成既有個案", clientCode: "TEST-001" }, { id: other, displayName: "合成另一個案", clientCode: "TEST-002" }]} initialSnapshot={snapshot} loadError={false} today="2026-09-14" archiveConfigured={false} />);
    fireEvent.change(screen.getByLabelText("個案電話"), { target: { value: "合成電話" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存基本資料" }));
    expect(await screen.findByRole("button", { name: "重試同一次儲存" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /1\s*匯入與建檔/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /3\s*每週到站與接送/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("目前處理的個案"), { target: { value: other } });
    expect(screen.getByLabelText("目前處理的個案")).toHaveValue(id);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getAllByRole("alert").some((element) => element.textContent?.includes("結果尚未確認"))).toBe(true);
    expect(screen.getByLabelText("個案電話")).toHaveValue("合成電話");
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
    vi.stubGlobal("fetch", vi.fn()); const confirm = vi.spyOn(window, "confirm");
    const other = "c1600000-0000-4000-8000-000000000002";
    render(<IntakeWorkspace context={{ organizationId: id, organizationName: "合成機構", branchId: other, branchName: "合成分支", userId: id, displayName: "合成管理員", roles: ["nurse"], scopes: [], assuranceLevel: "aal2", recentAal2At: null, demo: true }} clients={[{ id, clientCode: "TEST-01", displayName: "合成個案甲" }, { id: other, clientCode: "TEST-02", displayName: "合成個案乙" }]} initialSnapshot={{ clientId: id, profileVersion: 1, clientRowVersion: 1, pending: true, profile: { ...emptyIntakeProfile, displayName: "合成個案甲", clientCode: "TEST-01" }, fieldAuthority: {}, sourceBatchId: null }} loadError={false} today="2026-09-14" />);
    fireEvent.click(screen.getByRole("button", { name: /3\s*每週到站與接送/ }));
    fireEvent.click(await screen.findByLabelText("週一到站"));
    fireEvent.click(screen.getByRole("button", { name: /2\s*基本資料/ }));
    expect(screen.getByRole("heading", { name: "核對個案基本資料" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("目前處理的個案"), { target: { value: other } });
    expect(screen.getByRole("alertdialog", { name: "放棄輸入並更換個案？" })).toBeVisible();
    expect(screen.getByLabelText("目前處理的個案")).toHaveValue(id);
    fireEvent.click(screen.getByRole("button", { name: "繼續填寫" }));
    expect(screen.getByLabelText("目前處理的個案")).toHaveValue(id);
    await waitFor(() => expect(screen.getByLabelText("目前處理的個案")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: /3\s*每週到站與接送/ })); expect(screen.getByLabelText("週一到站")).toBeChecked();
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
  it("discards one client's draft only after confirmation and starts the chosen client with a clean form", async () => {
    const other = "c1600000-0000-4000-8000-000000000002";
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    render(<IntakeWorkspace context={{ ...newCaseContext, demo: true }} clients={[{ id, clientCode: "TEST-01", displayName: "合成個案甲" }, { id: other, clientCode: "TEST-02", displayName: "合成個案乙" }]} initialSnapshot={{ clientId: id, profileVersion: 1, clientRowVersion: 1, pending: true, profile: { ...emptyIntakeProfile, displayName: "合成個案甲", clientCode: "TEST-01" }, fieldAuthority: {}, sourceBatchId: null }} loadError={false} today="2026-09-14" />);
    fireEvent.change(screen.getByLabelText("姓名／顯示稱呼（必填）"), { target: { value: "合成未儲存名字" } });
    await waitFor(() => expect(window.history.state.__daycareIntakeUnsavedGuard).toEqual(expect.any(String)));
    expect(JSON.stringify(window.history.state)).not.toContain("合成未儲存名字");
    fireEvent.change(screen.getByLabelText("目前處理的個案"), { target: { value: other } });
    expect(screen.getByLabelText("目前處理的個案")).toHaveValue(id);
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveValue("合成未儲存名字");
    fireEvent.click(screen.getByRole("button", { name: "放棄並更換個案" }));
    await waitFor(() => expect(screen.getByLabelText("目前處理的個案")).toHaveValue(other));
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveValue("合成個案乙");
    expect(screen.getByLabelText("目前處理的個案")).toHaveFocus();
    expect(storageWrite).not.toHaveBeenCalled();
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (let index = 0; index < storage.length; index++) expect(storage.getItem(storage.key(index)!)).not.toContain("合成未儲存名字");
    }
  });
  it("fails closed if a modal cannot open, leaving the unsaved form intact", async () => {
    vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(() => { throw new Error("unsupported"); });
    render(<IntakeWorkspace context={newCaseContext} clients={[]} initialSnapshot={null} loadError={false} today="2026-09-14" archiveConfigured={false} />);
    fireEvent.change(screen.getByLabelText("姓名／顯示稱呼（必填）"), { target: { value: "合成未儲存名字" } });
    await waitFor(() => expect(window.history.state.__daycareIntakeUnsavedGuard).toEqual(expect.any(String)));
    fireEvent.click(screen.getByRole("link", { name: "個案中心" }));
    expect(routerReplace).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("無法安全確認離頁");
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveValue("合成未儲存名字");
  });
  it("does not offer discard while a save is in flight, including a browser Back", async () => {
    window.history.replaceState({ prior: true }, "", "/app/staff/workspace/case-center");
    window.history.pushState({ __NA: true }, "", "/app/client-intake");
    let rejectWrite!: (reason: Error) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((_resolve, reject) => { rejectWrite = reject; })));
    render(<IntakeWorkspace context={newCaseContext} clients={[]} initialSnapshot={null} loadError={false} today="2026-09-14" archiveConfigured={false} />);
    fireEvent.change(screen.getByLabelText("姓名／顯示稱呼（必填）"), { target: { value: "合成未儲存名字" } });
    fireEvent.change(screen.getByLabelText("機構個案編號（必填）"), { target: { value: "TEST-001" } });
    await waitFor(() => expect(window.history.state.__daycareIntakeUnsavedGuard).toEqual(expect.any(String)));
    const marker = window.history.state.__daycareIntakeUnsavedGuard;
    fireEvent.click(screen.getByRole("button", { name: "建立待收案個案" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存與核對中…" })).toBeDisabled());
    fireEvent.click(screen.getByRole("link", { name: "個案中心" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(routerReplace).not.toHaveBeenCalled();
    window.history.back();
    await waitFor(() => expect(window.history.state.__daycareIntakeUnsavedGuard).toBe(marker));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveValue("合成未儲存名字");
    rejectWrite(new Error("synthetic network failure"));
    await waitFor(() => expect(screen.getByRole("button", { name: "重試同一次儲存" })).toBeEnabled());
    fireEvent.click(screen.getByRole("link", { name: "個案中心" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(routerReplace).not.toHaveBeenCalled();
    window.history.back();
    await waitFor(() => expect(window.history.state.__daycareIntakeUnsavedGuard).toBe(marker));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("姓名／顯示稱呼（必填）")).toHaveValue("合成未儲存名字");
  });
});
