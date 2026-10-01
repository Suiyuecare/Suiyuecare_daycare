// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaipeiAbcdIntakeStep } from "./taipei-abcd-intake-step";
import { emptyWorkflow } from "@/lib/taipei-abcd/workflow";
import { taipeiExportModel } from "@/lib/taipei-abcd/export";
import { TAIPEI_ABCD_TEMPLATE } from "@/lib/taipei-abcd/catalog";
const ids = { organizationId: "aa010000-0000-4000-8000-000000000001", branchId: "aa010000-0000-4000-8000-000000000002", clientId: "aa010000-0000-4000-8000-000000000003" };
const empty = { ...ids, form: "A", usageYear: 115, month: 0, latest: null, history: [], currentSources: null, canEdit: true };
const fetchMock = vi.fn();
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
describe("Taipei intake draft UI", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); fetchMock.mockResolvedValue(Response.json({ data: empty }));
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
  });
  afterEach(() => {
    cleanup(); vi.unstubAllGlobals();
    for (const [name, descriptor] of [["showModal", originalShowModal], ["close", originalClose]] as const) {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
    }
  });
  it("shows full A section inventory and no D/signature action", () => {
    render(<TaipeiAbcdIntakeStep {...ids} demo />);
    expect(screen.getByText("僅存草稿")).toBeVisible();
    expect(screen.getByText("尚未完成評估、正式發布或簽署")).toBeVisible();
    const scope = screen.getByText("表單版本與適用範圍").closest("details")!;
    expect(scope).not.toHaveAttribute("open");
    expect(within(scope).getByText(/D 表是小規模多機能臨時住宿紀錄/)).not.toBeVisible();
    expect(screen.getByText("A24 · 服務期待與目標")).toBeInTheDocument();
    expect(screen.getByLabelText("案號內容")).toBeVisible();
    const firstSection = screen.getByText("A0 · 案號、收案日期與照片").closest("details")!;
    const originalPage = within(firstSection).getByText("原表出處").closest("details")!;
    expect(originalPage).not.toHaveAttribute("open");
    expect(within(originalPage).getByText("原表第 1 頁")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "儲存 A 表草稿" })).toBeDisabled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("loads before allowing save, then preserves exact idempotency key on uncertain retry", async () => {
    render(<TaipeiAbcdIntakeStep {...ids} />); await waitFor(() => expect(screen.getByRole("button", { name: "儲存 A 表草稿" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("個案姓名內容"), { target: { value: "合成個案" } });
    fetchMock.mockRejectedValue(new TypeError("連線暫時中斷"));
    fireEvent.click(screen.getByRole("button", { name: "儲存 A 表草稿" })); await screen.findByText("連線暫時中斷");
    const first = JSON.parse(fetchMock.mock.calls[1][1].body);
    fireEvent.click(screen.getByRole("button", { name: "以相同內容重試保存" })); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual(first);
  });
  it("does not reuse a previous client's private snapshot on client switch", async () => {
    const view = render(<TaipeiAbcdIntakeStep {...ids} />); await waitFor(() => expect(screen.getByRole("button", { name: "儲存 A 表草稿" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("個案姓名內容"), { target: { value: "先前個案私有草稿" } });
    fetchMock.mockImplementation(() => new Promise(() => {}));
    view.rerender(<TaipeiAbcdIntakeStep {...ids} clientId="aa010000-0000-4000-8000-000000000009" />);
    expect(screen.queryByDisplayValue("先前個案私有草稿")).not.toBeInTheDocument(); expect(screen.getByRole("status")).toHaveTextContent("載入");
  });
  it("keeps center assessments out of the CMS suggestion tray", async () => {
    render(<TaipeiAbcdIntakeStep {...ids} demo prefill={[{ fieldKey: "B13.center.0", value: "10", sourceLabel: "CMS" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "B 表 · 需求與照顧計畫" }));
    expect(screen.getByText("B13 · ADLs：照專與中心分開記錄")).toBeInTheDocument();
    expect(screen.queryByText(/可核對的 CMS 來源建議/)).not.toBeInTheDocument();
    expect(screen.getByText("B_PLAN · 三、個別化照顧計畫")).toBeInTheDocument();
  });
  it("failed reads stay fail-closed without synthesized success", async () => {
    fetchMock.mockResolvedValue(Response.json({ errors: [{ message: "無此個案權限" }] }, { status: 403 }));
    render(<TaipeiAbcdIntakeStep {...ids} />); await screen.findByText("無此個案權限"); expect(screen.getByRole("button", { name: "儲存 A 表草稿" })).toBeDisabled();
  });
  it("reports dirty state and confirms persisted version through a second GET before success", async () => {
    const onDirty = vi.fn(); const onBusy = vi.fn(); let saved: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      if (init.method === "POST") { const body = JSON.parse(String(init.body)); saved = { ...ids, id: "aa010000-0000-4000-8000-000000000008", form: "A", usageYear: 115, month: 0,
        version: 1, previousVersionId: null, contentHash: "a".repeat(64), answers: body.answers, sourceSnapshot: null, createdAt: "2026-09-14T01:00:00Z", state: "draft", publicationStatus: "pending_approval" };
        return Response.json({ data: { draft: saved, replayed: false, idempotencyKey: body.idempotency_key } }); }
      return Response.json({ data: { ...empty, latest: saved } });
    });
    render(<TaipeiAbcdIntakeStep {...ids} onDirty={onDirty} onBusy={onBusy} today="2026-09-14" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存 A 表草稿" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("個案姓名內容"), { target: { value: "讀回合成個案" } }); expect(onDirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "儲存 A 表草稿" })); await screen.findByText(/已保存 A 表草稿第 1 版/);
    // A saved DOM message may precede the parent-facing passive effects.
    // Keep every required callback value and the original waitFor timeout.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3); expect(onDirty).toHaveBeenLastCalledWith(false);
      expect(onBusy).toHaveBeenCalledWith(true); expect(onBusy).toHaveBeenLastCalledWith(false);
    });
  });
  it("starts C on the parent-supplied Taipei current month without hydration clock guessing", () => {
    render(<TaipeiAbcdIntakeStep {...ids} demo today="2026-09-14" />); fireEvent.click(screen.getByRole("button", { name: "C 表 · 當月執行" }));
    expect(screen.getByLabelText("115 年度月份")).toHaveValue("9");
  });
  it("shows frozen C evidence for approved review and PDF, with newer sources in a separate collapsed view", async () => {
    const base = { capturedAt: "2026-09-14T01:00:00Z", healthAccess: true, careAccess: true, careRecords: [] };
    const savedSources = { ...base, measurements: [{ id: "aa010000-0000-4000-8000-000000000011", measuredAt: base.capturedAt, kind: "weight", numericValue: 53, textValue: null, unit: "kg", recordedBy: "保存來源人員" }] };
    const currentSources = { ...base, measurements: [{ ...savedSources.measurements[0], id: "aa010000-0000-4000-8000-000000000012", numericValue: 66, recordedBy: "最新來源人員" }] };
    const draft = { ...ids, id: "aa010000-0000-4000-8000-000000000008", form: "C", usageYear: 115, month: 9, version: 1, previousVersionId: null, contentHash: "a".repeat(64), answers: {}, sourceSnapshot: savedSources, createdAt: base.capturedAt, state: "draft", publicationStatus: "pending_approval" };
    const workflow = { ...emptyWorkflow, state: "approved", sequence: 2 };
    fetchMock.mockImplementation(async (url: string) => new URL(url, "http://localhost").searchParams.get("form") === "C" ? Response.json({ data: { ...empty, form: "C", month: 9, latest: draft, workflow, currentSources, canEdit: false } }) : Response.json({ data: empty }));
    render(<TaipeiAbcdIntakeStep {...ids} today="2026-09-14" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存 A 表草稿" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "C 表 · 當月執行" }));
    const saved = await screen.findByRole("region", { name: "C 表已保存版本來源" });
    expect(screen.getByText("C 表只引用當月實際量測與已簽署照顧紀錄；CMS 與到站安排不算執行。")).toBeVisible();
    expect(within(saved).getByText("已保存第 1 版的來源").closest("details")).not.toHaveAttribute("open");
    expect(within(saved).getByText("53 kg")).toBeInTheDocument(); expect(within(saved).queryByText("66 kg")).not.toBeInTheDocument();
    fireEvent.click(within(saved).getByText("已保存第 1 版的來源"));
    fireEvent.click(within(saved).getByText(/C1 當月實際量測：1 筆/u));
    expect(within(saved).getByText("53 kg")).toBeVisible();
    const current = screen.getByText("查看目前最新來源（不屬於已保存版本）").closest("details")!;
    expect(current).not.toHaveAttribute("open");
    fireEvent.click(within(current).getByText("查看目前最新來源（不屬於已保存版本）"));
    fireEvent.click(within(current).getByText(/C1 當月實際量測：1 筆/u));
    expect(within(current).getByText("66 kg")).toBeVisible();
    expect(within(current).queryByText("53 kg")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "儲存 C 表草稿" })).toBeDisabled();
    const model = taipeiExportModel({ draft, workflow, generatedAt: base.capturedAt, sourceRevision: "114.11", sourceSha256: TAIPEI_ABCD_TEMPLATE.sourceSha256, templateKey: TAIPEI_ABCD_TEMPLATE.key, organization: { organizationId: ids.organizationId, organizationName: "合成", branchId: ids.branchId, branchName: "合成" }, client: { clientId: ids.clientId, displayName: "合成", clientCode: null }, isElectronicSignature: false, isOfficialComplete: false, rendererVersion: "taipei-crosswalk-v1", fontAssetKey: "taipei-crosswalk-font-v1" }, draft.id, "b".repeat(64));
    const values = model.sections.flatMap(s => s.rows.map(r => r.value)).join(" ");
    expect(values).toContain("53 kg"); expect(values).not.toContain("66 kg"); expect(values).toContain(savedSources.measurements[0].id); expect(values).not.toContain(currentSources.measurements[0].id);
  });
  it("uses the app-owned dialog to preserve a C draft on Cancel and Escape, then switches only after explicit discard", async () => {
    const nativeConfirm = vi.fn(); vi.stubGlobal("confirm", nativeConfirm);
    fetchMock.mockImplementation(async (url: string) => { const query = new URL(url, "http://localhost").searchParams; return Response.json({ data: { ...empty, form: query.get("form"), month: Number(query.get("month")) } }); });
    render(<TaipeiAbcdIntakeStep {...ids} today="2026-09-14" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存 A 表草稿" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "C 表 · 當月執行" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存 C 表草稿" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("備註（例如左／右手禁測量）內容"), { target: { value: "合成核對草稿" } });
    fireEvent.change(screen.getByLabelText("115 年度月份"), { target: { value: "10" } });
    const firstDialog = screen.getByRole("dialog", { name: "捨棄未保存的表單內容" });
    expect(within(firstDialog).getByText(/切換到 10 月會捨棄/u)).toBeInTheDocument();
    expect(screen.getByLabelText("115 年度月份")).toHaveValue("9");
    fireEvent.click(within(firstDialog).getByRole("button", { name: "繼續填寫" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "A 表 · 基本資料" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("備註（例如左／右手禁測量）內容")).toHaveValue("合成核對草稿");
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(nativeConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "A 表 · 基本資料" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "捨棄填寫並繼續" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存 A 表草稿" })).toBeEnabled());
    expect(screen.queryByDisplayValue("合成核對草稿")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("keeps an uncertain original save immutable and blocks form/month/reload until exact retry", async () => {
    const onBusy = vi.fn();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => init?.method === "POST" ? Promise.reject(new Error("NETWORK_UNKNOWN")) : Response.json({ data: { ...empty, form: new URL(url, "http://localhost").searchParams.get("form") } }));
    render(<TaipeiAbcdIntakeStep {...ids} onBusy={onBusy} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存 A 表草稿" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("個案姓名內容"), { target: { value: "原次姓名" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存 A 表草稿" }));
    await screen.findByText("NETWORK_UNKNOWN");
    expect(screen.getByLabelText("個案姓名內容")).toBeDisabled();
    expect(screen.getByRole("button", { name: "以相同內容重試保存" })).toBeEnabled();
    expect(onBusy).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "C 表 · 當月執行" }));
    expect(screen.getByRole("button", { name: "A 表 · 基本資料" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新載入" })).toBeDisabled();
    const first = fetchMock.mock.calls[1][1].body;
    fireEvent.click(screen.getByRole("button", { name: "以相同內容重試保存" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][1].body).toBe(first);
  });
  it("releases a first, definitively rejected draft for correction with a new key", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? Response.json({ requestId: "aa010000-0000-4000-8000-000000000051", status: "error", data: null, errors: [{ code: "INVALID_TAIPEI_ABCD_DRAFT", message: "請核對資料狀態" }] }, { status: 400 })
      : Response.json({ data: empty }));
    render(<TaipeiAbcdIntakeStep {...ids} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存 A 表草稿" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("個案姓名內容"), { target: { value: "首次值" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存 A 表草稿" }));
    await screen.findByText("請核對資料狀態");
    expect(screen.getByLabelText("個案姓名內容")).toBeEnabled();
    expect(screen.getByRole("button", { name: "儲存 A 表草稿" })).toBeEnabled();
    const first = JSON.parse(fetchMock.mock.calls[1][1].body);
    fireEvent.change(screen.getByLabelText("個案姓名內容"), { target: { value: "修正值" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存 A 表草稿" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const second = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(second.answers["A1.name"].value).toBe("修正值");
    expect(second.idempotency_key).not.toBe(first.idempotency_key);
  });
  it("keeps the original key after an uncertain attempt even if its retry receives a 400 envelope", async () => {
    let postCount = 0;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return Response.json({ data: empty });
      postCount += 1;
      if (postCount === 1) throw new TypeError("網路中斷");
      return Response.json({ requestId: "aa010000-0000-4000-8000-000000000052", status: "error", data: null, errors: [{ code: "INVALID_TAIPEI_ABCD_DRAFT", message: "回覆被拒" }] }, { status: 400 });
    });
    render(<TaipeiAbcdIntakeStep {...ids} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存 A 表草稿" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("個案姓名內容"), { target: { value: "原值" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存 A 表草稿" }));
    await screen.findByText("網路中斷");
    const first = fetchMock.mock.calls[1][1].body;
    fireEvent.click(screen.getByRole("button", { name: "以相同內容重試保存" }));
    await screen.findByText("回覆被拒");
    expect(screen.getByLabelText("個案姓名內容")).toBeDisabled();
    expect(screen.getByRole("button", { name: "以相同內容重試保存" })).toBeEnabled();
    expect(fetchMock.mock.calls[2][1].body).toBe(first);
  });
  it("keeps the original key when a 400 response lacks a complete error envelope", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? Response.json({ status: "error", data: null, errors: [{ code: "INVALID_TAIPEI_ABCD_DRAFT", message: "缺少請求識別碼" }] }, { status: 400 })
      : Response.json({ data: empty }));
    render(<TaipeiAbcdIntakeStep {...ids} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存 A 表草稿" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("個案姓名內容"), { target: { value: "待確認值" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存 A 表草稿" }));
    await screen.findByText("缺少請求識別碼");
    expect(screen.getByLabelText("個案姓名內容")).toBeDisabled();
    expect(screen.getByRole("button", { name: "以相同內容重試保存" })).toBeEnabled();
  });
  it("stops offering save after a confirmed permission rejection without erasing local input", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? Response.json({ requestId: "aa010000-0000-4000-8000-000000000053", status: "error", data: null, errors: [{ code: "TAIPEI_ABCD_NOT_AUTHORIZED", message: "此帳號無寫入權限" }] }, { status: 403 })
      : Response.json({ data: empty }));
    render(<TaipeiAbcdIntakeStep {...ids} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存 A 表草稿" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("個案姓名內容"), { target: { value: "保留在畫面的內容" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存 A 表草稿" }));
    await screen.findByText("此帳號無寫入權限");
    expect(screen.getByRole("button", { name: "儲存 A 表草稿" })).toBeDisabled();
    expect(screen.getByDisplayValue("保留在畫面的內容")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新載入" })).toBeEnabled();
  });
  it("releases the parent busy guard when unmounted during save", async () => {
    const onBusy = vi.fn();
    const view = render(<TaipeiAbcdIntakeStep {...ids} onBusy={onBusy} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存 A 表草稿" })).toBeEnabled());
    fetchMock.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "儲存 A 表草稿" }));
    expect(onBusy).toHaveBeenLastCalledWith(true);
    view.unmount(); expect(onBusy).toHaveBeenLastCalledWith(false);
  });
  it("opens and focuses an incomplete field instead of a generic error among hundreds of fields", async () => {
    render(<TaipeiAbcdIntakeStep {...ids} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存 A 表草稿" })).toBeEnabled());
    const state = screen.getByLabelText("個案姓名資料狀態");
    fireEvent.change(state, { target: { value: "recorded" } });
    const section = state.closest("details")!; section.open = false;
    fireEvent.click(screen.getByRole("button", { name: "儲存 A 表草稿" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("「個案姓名」的內容或資料狀態尚未完成");
    expect(section.open).toBe(true); expect(state).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(state).toHaveFocus());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
