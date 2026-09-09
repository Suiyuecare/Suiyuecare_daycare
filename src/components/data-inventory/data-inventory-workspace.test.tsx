// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDataInventoryContent } from "@/lib/data-inventory/types";
import { DataInventoryWorkspace, inventoryDisplayStatus } from "./data-inventory-workspace";
import { inventoryIds, inventoryReceiptEnvelope, inventoryTestOperation, inventoryTestSnapshot, inventoryTestVersion } from "./data-inventory-test-fixtures";
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const baseProps = { canManage: true, canReview: true, hasRecentAal2: true, actorUserId: inventoryIds.actorUserId };
const saveButton = () => screen.getByRole("button", { name: "保存盤點新版本" });
const startNew = () => fireEvent.click(screen.getByRole("button", { name: "登錄盤點：個案基本資料" }));
const startReview = () => fireEvent.click(screen.getByRole("button", { name: "人工覆核：個案基本資料" }));
afterEach(() => { cleanup(); refresh.mockReset(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("data inventory embedded workspace", () => {
  it("shows 12 fixed requirements, six categories and honest read-only synthetic boundaries", () => {
    const { container } = render(<DataInventoryWorkspace {...baseProps} snapshot={{ ...inventoryTestSnapshot(), demo: true }}/>);
    expect(screen.getByRole("heading", { level: 2, name: "資料盤點與缺漏追蹤" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(container.querySelector("#data-inventory")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^登錄盤點/ })).toHaveLength(12);
    for (const button of screen.getAllByRole("button", { name: /^(登錄盤點|人工覆核)/ })) expect(button).toBeDisabled();
    expect(within(screen.getByLabelText("資料類別")).getAllByRole("option")).toHaveLength(7);
    expect(screen.getByText(/盤點完成 ≠ 正式資料完整 ≠ 89 頁驗收完成/)).toBeInTheDocument();
    expect(screen.getByText(/正式欄位轉入、七年資料移轉、附件封存及自動對帳尚未設定/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /前往中央 HTML 匯入/ })).toHaveAttribute("href", "/app/staff/governance/central-html-import");
    expect(container.querySelector('input[type="file"], input[type="password"], iframe, form')).toBeNull();
  });
  it("does not label fixed synthetic fixtures as expired formal records", () => {
    render(<DataInventoryWorkspace {...baseProps} snapshot={{ ...inventoryTestSnapshot(), demo: true,
      generatedAt: "2026-01-01T00:00:00Z", staleAfter: "2026-01-01T00:05:00Z" }}/>);
    expect(screen.queryByText(/資料已過期或剛完成操作/)).not.toBeInTheDocument();
    expect(screen.getByText(/非正式資料更新時間/)).toBeInTheDocument();
  });
  it("filters locally and offers an actionable empty state without fetching", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<DataInventoryWorkspace {...baseProps} snapshot={inventoryTestSnapshot()}/>);
    fireEvent.change(screen.getByLabelText("資料類別"), { target: { value: "實際服務" } });
    expect(screen.getAllByRole("button", { name: /^登錄盤點/ })).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("盤點狀態"), { target: { value: "verified" } });
    expect(screen.getByRole("heading", { name: "此篩選沒有盤點項目" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除篩選" }));
    expect(screen.getAllByRole("button", { name: /^登錄盤點/ })).toHaveLength(12);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps missing, received, pending-review, verified and not-applicable distinct", () => {
    expect(inventoryDisplayStatus("client_master")).toBe("missing");
    const received = inventoryTestVersion(); received.content.actualCount = 2;
    expect(inventoryDisplayStatus("client_master", received)).toBe("received");
    expect(inventoryDisplayStatus("client_master", inventoryTestVersion())).toBe("pending_review");
    expect(inventoryDisplayStatus("client_master", inventoryTestVersion({ reviewState: "manually_verified" }))).toBe("verified");
    const na = inventoryTestVersion({ reviewState: "manually_verified" }); na.content.status = "not_applicable";
    expect(inventoryDisplayStatus("client_master", na)).toBe("not_applicable");
  });
  it("shows unknown counts as unknown and highlights mismatches with text", () => {
    const version = inventoryTestVersion(); version.content.actualCount = 2; version.content.missingRequired = null;
    render(<DataInventoryWorkspace {...baseProps} snapshot={inventoryTestSnapshot(version)}/>);
    expect(screen.getByText(/筆數不一致：來源應有 3 筆，實際取得 2 筆/)).toBeInTheDocument();
    expect(screen.getAllByText("尚未盤點（不是 0）").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "人工覆核：個案基本資料" })).toBeDisabled();
  });
  it("does not substitute synthetic metadata after a formal load failure", () => {
    render(<DataInventoryWorkspace {...baseProps} snapshot={null} loadError/>);
    expect(screen.getByRole("alert")).toHaveTextContent("盤點資料暫時無法載入");
    expect(screen.queryByText("唯讀合成示例")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新載入盤點資料" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it.each([{ canManage: false }, { actorUserId: undefined }])("blocks metadata edits without authority %s", (override) => {
    render(<DataInventoryWorkspace {...baseProps} {...override} snapshot={inventoryTestSnapshot()}/>);
    expect(screen.getByRole("button", { name: "登錄盤點：個案基本資料" })).toBeDisabled();
  });
  it("requires recent AAL2 and independent reviewer", () => {
    const snapshot = inventoryTestSnapshot(inventoryTestVersion());
    const { rerender } = render(<DataInventoryWorkspace {...baseProps} snapshot={snapshot} hasRecentAal2={false}/>);
    expect(screen.getByRole("button", { name: "人工覆核：個案基本資料" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "更新盤點：個案基本資料" })).toBeEnabled();
    expect(screen.getAllByRole("link", { name: "前往重新驗證" })[0]).toHaveAttribute("href", "/mfa?audience=staff&purpose=sensitive-action");
    rerender(<DataInventoryWorkspace {...baseProps} snapshot={snapshot} actorUserId={inventoryIds.recorder}/>);
    expect(screen.getByRole("button", { name: "人工覆核：個案基本資料" })).toBeDisabled();
    expect(screen.getByText(/您是本版內容登錄者/)).toBeInTheDocument();
  });
  it("only saves after explicit submission and preserves null as unknown", async () => {
    const fetch = vi.fn().mockImplementation(async (_url, init) => {
      const { idempotency_key, ...request } = JSON.parse(init.body);
      return new Response(JSON.stringify(inventoryReceiptEnvelope({ ...inventoryTestOperation(request), idempotencyKey: idempotency_key })), { status: 201 });
    });
    vi.stubGlobal("fetch", fetch);
    render(<DataInventoryWorkspace {...baseProps} snapshot={inventoryTestSnapshot()}/>);
    startNew();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText("資料負責角色（非具名承辦人）")).toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const request = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(request.content).toEqual(emptyDataInventoryContent());
    expect(request.expectedVersion).toBe(0);
  });
  it("clears dates/counts for NA and sends explicit reason/reconciliation states", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 })); vi.stubGlobal("fetch", fetch);
    render(<DataInventoryWorkspace {...baseProps} snapshot={inventoryTestSnapshot(inventoryTestVersion())}/>);
    fireEvent.click(screen.getByRole("button", { name: "更新盤點：個案基本資料" }));
    fireEvent.change(screen.getByLabelText("取得狀態"), { target: { value: "not_applicable" } });
    expect(screen.queryByLabelText("來源應有筆數")).not.toBeInTheDocument();
    expect(screen.getByLabelText("不適用原因（必填）")).toHaveValue("out_of_scope");
    fireEvent.click(saveButton());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetch.mock.calls[0]![1].body).content).toMatchObject({ status: "not_applicable", expectedCount: null,
      actualCount: null, periodStart: null, periodEnd: null, missingRequired: null, keyFields: "not_applicable", reasonCode: "out_of_scope" });
  });
  it("rejects invalid paired dates before network submission", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<DataInventoryWorkspace {...baseProps} snapshot={inventoryTestSnapshot()}/>); startNew();
    fireEvent.change(screen.getByLabelText("涵蓋起日"), { target: { value: "2026-09-01" } });
    fireEvent.click(saveButton());
    expect(screen.getByRole("alert")).toHaveTextContent("請檢查成對的起訖日期");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires explicit acknowledgment and sends version/hash-bound review", async () => {
    const fetch = vi.fn().mockImplementation(async (_url, init) => {
      const { idempotency_key, ...request } = JSON.parse(init.body);
      return new Response(JSON.stringify(inventoryReceiptEnvelope({ ...inventoryTestOperation(request), idempotencyKey: idempotency_key })), { status: 201 });
    });
    vi.stubGlobal("fetch", fetch);
    const version = inventoryTestVersion();
    render(<DataInventoryWorkspace {...baseProps} snapshot={inventoryTestSnapshot(version)}/>); startReview();
    const confirm = screen.getByRole("button", { name: "確認人工覆核並追加版本" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(confirm);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ action: "verify", expectedVersion: 1,
      expectedVersionId: version.versionId, expectedContentHash: version.contentHash });
    expect(screen.getByText(/這不代表正式資料已匯入或上線驗收通過/)).toBeInTheDocument();
  });
  it("locks an unknown result and retries the same payload/key without duplicate submission", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response("{}", { status: 200 })); vi.stubGlobal("fetch", fetch);
    render(<DataInventoryWorkspace {...baseProps} snapshot={inventoryTestSnapshot()}/>); startNew();
    fireEvent.click(saveButton()); fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole("button", { name: "以相同內容與識別碼重試" })).toBeEnabled());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("資料類別")).toBeDisabled();
    expect(saveButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "以相同內容與識別碼重試" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[0]![1].body).toBe(fetch.mock.calls[1]![1].body);
    expect(fetch.mock.calls[0]![1].headers["idempotency-key"]).toBe(fetch.mock.calls[1]![1].headers["idempotency-key"]);
    expect(refresh).not.toHaveBeenCalled();
  });
  it("lets a confirmed rejection be corrected without showing untrusted response text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ requestId: inventoryIds.operationId,
      status: "error", data: null, errors: [{ code: "INVALID_DATA_INVENTORY", message: "SECRET_DO_NOT_RENDER" }] }), { status: 400 })));
    render(<DataInventoryWorkspace {...baseProps} snapshot={inventoryTestSnapshot()}/>); startNew(); fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(screen.getByRole("alert")).toHaveTextContent("尚未保存");
    expect(screen.queryByText(/SECRET_DO_NOT_RENDER/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "以相同內容與識別碼重試" })).not.toBeInTheDocument();
  });
  it("never silently rebases an open editor when refreshed snapshot changes", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const snapshot = inventoryTestSnapshot();
    const { rerender } = render(<DataInventoryWorkspace {...baseProps} snapshot={snapshot}/>); startNew();
    rerender(<DataInventoryWorkspace {...baseProps} snapshot={{ ...snapshot, generatedAt: new Date(Date.parse(snapshot.generatedAt) + 1000).toISOString() }}/>);
    fireEvent.click(saveButton());
    expect(screen.getByRole("alert")).toHaveTextContent("畫面版本已更新"); expect(fetch).not.toHaveBeenCalled();
  });
  it("disables exact retry after actor or branch scope changes", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response("{}", { status: 200 })); vi.stubGlobal("fetch", fetch);
    const snapshot = inventoryTestSnapshot();
    const { rerender } = render(<DataInventoryWorkspace {...baseProps} snapshot={snapshot}/>); startNew(); fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole("button", { name: "以相同內容與識別碼重試" })).toBeEnabled());
    rerender(<DataInventoryWorkspace {...baseProps} snapshot={{ ...snapshot, branchId: inventoryIds.evidence }}/>);
    expect(screen.getByRole("button", { name: "以相同內容與識別碼重試" })).toBeDisabled();
    expect(screen.getByText(/目前機構、分支或帳號已變更/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("blocks stale writes and never auto-submits on reconnect", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<DataInventoryWorkspace {...baseProps} snapshot={{ ...inventoryTestSnapshot(), staleAfter: new Date(Date.now() - 1).toISOString() }}/>);
    expect(screen.getByRole("button", { name: "登錄盤點：個案基本資料" })).toBeDisabled();
    expect(screen.getByText(/目前離線，不能保存或覆核/)).toBeInTheDocument();
    fireEvent(window, new Event("online")); expect(fetch).not.toHaveBeenCalled();
  });
});
