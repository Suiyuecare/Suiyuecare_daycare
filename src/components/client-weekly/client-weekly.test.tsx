// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyPlan, previewWeeklyPlan } from "@/lib/client-weekly/schema";
import { ClientWeeklyWorkspace } from "./client-weekly-workspace";
const clientId = "c1600000-0000-4000-8000-000000000001";
const today = "2026-09-14";
function snapshot() { return { clientId, from: today, generatedAt: `${today}T00:00:00Z`, version: 0, plan: null, exceptions: [], days: previewWeeklyPlan(emptyPlan(today), today) }; }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("weekly intake editor", () => {
  it("lets a synthetic user try four Mondays without claiming storage or doing network requests", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<ClientWeeklyWorkspace clientId={clientId} today={today} canManage demo />);
    fireEvent.click(screen.getByLabelText("週一到站"));
    expect(screen.getAllByText("應到・尚非出勤")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "展示模式不儲存" })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("separates outbound and inbound fields and clears transport when not attending", () => {
    render(<ClientWeeklyWorkspace clientId={clientId} today={today} canManage demo />);
    fireEvent.click(screen.getByLabelText("週一到站")); fireEvent.click(screen.getByLabelText("週一去程需要交通車"));
    expect(screen.getByLabelText("週一去程接送地點")).toBeVisible();
    expect(screen.queryByLabelText("週一回程接送地點")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("週一到站"));
    expect(screen.queryByLabelText("週一去程接送地點")).not.toBeInTheDocument();
  });
  it("shows read failures, not fake empty saved data, and keeps writes disabled", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "error", errors: [{ message: "安排服務暫停" }] }, { status: 503 })));
    render(<ClientWeeklyWorkspace clientId={clientId} today={today} canManage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("安排服務暫停");
    expect(screen.getByRole("button", { name: "儲存每週安排" })).toBeDisabled();
  });
  it("does not allow a read-only member to edit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "ok", data: snapshot() })));
    render(<ClientWeeklyWorkspace clientId={clientId} today={today} canManage={false} />);
    await waitFor(() => expect(screen.queryByText("正在讀取每週安排…")).not.toBeInTheDocument());
    expect(screen.getByLabelText("週一到站")).toBeDisabled();
    expect(screen.getByRole("button", { name: "儲存每週安排" })).toBeDisabled();
  });
  it("retains both drafts when cancelling a date switch or reload", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: "ok", data: snapshot() }));
    const confirm = vi.fn().mockReturnValue(false); vi.stubGlobal("confirm", confirm); vi.stubGlobal("fetch", fetch);
    render(<ClientWeeklyWorkspace clientId={clientId} today={today} canManage />);
    await waitFor(() => expect(screen.getByLabelText("單日異動理由")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("安排依據／異動理由"), { target: { value: "家屬核對的固定週表" } });
    fireEvent.change(screen.getByLabelText("單日異動理由"), { target: { value: "家屬通知臨時請假" } });
    fireEvent.change(screen.getByLabelText(/異動日期/), { target: { value: "2026-09-15" } });
    expect(screen.getByLabelText(/異動日期/)).toHaveValue(today);
    expect(screen.getByLabelText("單日異動理由")).toHaveValue("家屬通知臨時請假");
    fireEvent.click(screen.getByRole("button", { name: "捨棄草稿並重新載入" }));
    expect(confirm).toHaveBeenCalledTimes(2); expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("安排依據／異動理由")).toHaveValue("家屬核對的固定週表");
  });
  it("validates a receipt then rereads before declaring saved and maintains original idempotency on uncertain retry", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: "ok", data: snapshot() }))
      .mockRejectedValueOnce(new Error("連線中斷"))
      .mockImplementationOnce(async () => {
        return Response.json({ status: "ok", data: { receipt: { id: "c1900000-0000-4000-8000-000000000001", clientId, action: "save_plan", version: 1, replayed: true, persisted: true } } });
      })
      .mockImplementationOnce(async () => Response.json({ status: "ok", data: { ...snapshot(), version: 1, plan: { ...emptyPlan(today), reason: "已核對固定安排", id: "c1900000-0000-4000-8000-000000000001", version: 1 } } }));
    vi.stubGlobal("fetch", fetch);
    render(<ClientWeeklyWorkspace clientId={clientId} today={today} canManage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存每週安排" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("安排依據／異動理由"), { target: { value: "已核對固定安排" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存每週安排" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("連線中斷");
    fireEvent.click(screen.getByRole("button", { name: "重試確認原次儲存" }));
    expect(await screen.findByText(/已儲存並重新讀回第 1 版/)).toBeVisible();
    expect(JSON.parse(fetch.mock.calls[1][1].body).idempotency_key).toBe(JSON.parse(fetch.mock.calls[2][1].body).idempotency_key);
    expect(fetch.mock.calls[3][0]).toContain("/api/client-weekly?");
  });
  it.each([[400, "INVALID_WEEKLY_INPUT"], [401, "AUTH_REQUIRED"], [403, "WEEKLY_FORBIDDEN"], [409, "WEEKLY_CONFLICT"]])("keeps the original body frozen after uncertainty followed by %s", async (status, code) => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: "ok", data: snapshot() }))
      .mockRejectedValueOnce(new Error("連線中斷"))
      .mockResolvedValueOnce(Response.json({ status: "error", errors: [{ code, message: "本次被拒絕" }] }, { status: Number(status) }))
      .mockRejectedValueOnce(new Error("仍待確認"));
    vi.stubGlobal("fetch", fetch);
    render(<ClientWeeklyWorkspace clientId={clientId} today={today} canManage />);
    await waitFor(() => expect(screen.getByLabelText("安排依據／異動理由")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("安排依據／異動理由"), { target: { value: "原本的固定安排" } });
    fireEvent.change(screen.getByLabelText("單日異動理由"), { target: { value: "另一筆尚未送出的請假" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存每週安排" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("連線中斷");
    expect(screen.getByLabelText("安排依據／異動理由")).toBeDisabled();
    expect(screen.getByLabelText("單日異動理由")).toBeDisabled();
    expect(screen.getByLabelText(/異動日期/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "儲存單日異動" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "捨棄草稿並重新載入" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "儲存單日異動" }));
    expect(fetch).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "重試確認原次儲存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("本次被拒絕");
    expect(screen.queryByRole("button", { name: "讀取目前版本供核對" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("安排依據／異動理由")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重試確認原次儲存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("仍待確認");
    const bodies = fetch.mock.calls.slice(1).map((call) => call[1].body);
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0])).toMatchObject({ action: "save_plan", clientId, expectedVersion: 0, plan: { reason: "原本的固定安排" } });
    expect(screen.getByLabelText("單日異動理由")).toHaveValue("另一筆尚未送出的請假");
  });
  it("requires explicit conflict read and acknowledgement, preserves both drafts, and only then uses a fresh base", async () => {
    const latest = { ...snapshot(), version: 2, plan: { ...emptyPlan(today), reason: "主管已核對的目前安排", id: "c1900000-0000-4000-8000-000000000001", version: 2 } };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: "ok", data: snapshot() }))
      .mockResolvedValueOnce(Response.json({ status: "error", errors: [{ code: "WEEKLY_CONFLICT", message: "安排已被修改" }] }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: latest }))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { receipt: { id: "c1900000-0000-4000-8000-000000000002", clientId, action: "save_plan", version: 3, replayed: false, persisted: true } } }))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { ...latest, version: 3, plan: { ...latest.plan, version: 3, reason: "我保留的安排草稿" } } }));
    vi.stubGlobal("fetch", fetch);
    render(<ClientWeeklyWorkspace clientId={clientId} today={today} canManage />);
    await waitFor(() => expect(screen.getByLabelText("安排依據／異動理由")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("安排依據／異動理由"), { target: { value: "我保留的安排草稿" } });
    fireEvent.change(screen.getByLabelText("單日異動理由"), { target: { value: "保留的單日草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存每週安排" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("安排已被修改");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "儲存每週安排" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "讀取目前版本供核對" }));
    expect(await screen.findByText(/伺服器目前安排・週表第 2 版/)).toBeVisible();
    expect(screen.getByLabelText("安排依據／異動理由")).toHaveValue("我保留的安排草稿");
    expect(screen.getByLabelText("單日異動理由")).toHaveValue("保留的單日草稿");
    expect(screen.getByRole("button", { name: "採用核對版本，繼續編輯草稿" })).toBeDisabled();
    expect(fetch).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByLabelText(/我已比對目前安排/));
    fireEvent.click(screen.getByRole("button", { name: "採用核對版本，繼續編輯草稿" }));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "儲存每週安排" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "儲存每週安排" }));
    expect(await screen.findByText(/已儲存並重新讀回第 3 版/)).toBeVisible();
    const original = JSON.parse(fetch.mock.calls[1][1].body);
    const next = JSON.parse(fetch.mock.calls[3][1].body);
    expect(next).toMatchObject({ expectedVersion: 2, plan: { reason: "我保留的安排草稿" } });
    expect(next.idempotency_key).not.toBe(original.idempotency_key);
    expect(screen.getByLabelText("單日異動理由")).toHaveValue("保留的單日草稿");
  });
  it("freezes a single-day operation's date and does not replace it with the weekly draft", async () => {
    const day = emptyPlan(today).days[0];
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: "ok", data: snapshot() }))
      .mockRejectedValueOnce(new Error("單日結果尚未收到"))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { receipt: { id: "c1900000-0000-4000-8000-000000000001", clientId, action: "save_exception", version: 1, replayed: true, persisted: true } } }))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { ...snapshot(), exceptions: [{ serviceDate: today, day, reason: "家屬確認當日請假", version: 1 }] } }));
    vi.stubGlobal("fetch", fetch);
    render(<ClientWeeklyWorkspace clientId={clientId} today={today} canManage />);
    await waitFor(() => expect(screen.getByLabelText("單日異動理由")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("安排依據／異動理由"), { target: { value: "不同固定安排草稿" } });
    fireEvent.change(screen.getByLabelText("單日異動理由"), { target: { value: "家屬確認當日請假" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存單日異動" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("單日結果尚未收到");
    fireEvent.change(screen.getByLabelText(/異動日期/), { target: { value: "2026-09-15" } });
    expect(screen.getByLabelText(/異動日期/)).toHaveValue(today);
    fireEvent.click(screen.getByRole("button", { name: "儲存每週安排" }));
    expect(fetch).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "重試確認原次儲存" }));
    expect(await screen.findByText(/已儲存並重新讀回第 1 版/)).toBeVisible();
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[2][1].body);
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({ action: "save_exception", serviceDate: today, expectedVersion: 0 });
    expect(screen.getByLabelText("安排依據／異動理由")).toHaveValue("不同固定安排草稿");
  });
  it("settles a positively acknowledged write with a newer readback through review, without another mutation", async () => {
    const latest = { ...snapshot(), version: 2, plan: { ...emptyPlan(today), reason: "主管後續核對的安排", id: "c1900000-0000-4000-8000-000000000002", version: 2 } };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: "ok", data: snapshot() }))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { receipt: { id: "c1900000-0000-4000-8000-000000000001", clientId, action: "save_plan", version: 1, replayed: false, persisted: true } } }))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: latest }));
    vi.stubGlobal("fetch", fetch);
    render(<ClientWeeklyWorkspace clientId={clientId} today={today} canManage />);
    await waitFor(() => expect(screen.getByLabelText("安排依據／異動理由")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("安排依據／異動理由"), { target: { value: "已送出的原次安排" } });
    fireEvent.change(screen.getByLabelText("單日異動理由"), { target: { value: "尚未送出的其他草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存每週安排" }));
    expect(await screen.findByText("原次已儲存，目前另有更新版本")).toBeVisible();
    expect(screen.getByLabelText("安排依據／異動理由")).toHaveValue("已送出的原次安排");
    expect(screen.getByRole("button", { name: "採用目前安排，結束確認" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/我已比對目前安排/));
    fireEvent.click(screen.getByRole("button", { name: "採用目前安排，結束確認" }));
    expect(screen.getByLabelText("安排依據／異動理由")).toHaveValue("主管後續核對的安排");
    expect(screen.getByLabelText("單日異動理由")).toHaveValue("尚未送出的其他草稿");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("button", { name: "重試確認原次儲存" })).not.toBeInTheDocument();
  });
  it.each([[503, "WEEKLY_RESULT_UNCERTAIN"], [409, "WEEKLY_RESULT_UNCERTAIN"], [409, "UNRECOGNIZED_CONFLICT"]])("keeps first %s %s responses uncertain rather than permitting rebase", async (status, code) => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: "ok", data: snapshot() }))
      .mockResolvedValueOnce(Response.json({ status: "error", errors: [{ code, message: "結果未確認" }] }, { status: Number(status) }));
    vi.stubGlobal("fetch", fetch);
    render(<ClientWeeklyWorkspace clientId={clientId} today={today} canManage />);
    await waitFor(() => expect(screen.getByLabelText("安排依據／異動理由")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("安排依據／異動理由"), { target: { value: "需要確認的安排" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存每週安排" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("結果未確認");
    expect(screen.getByRole("button", { name: "重試確認原次儲存" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "讀取目前版本供核對" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("安排依據／異動理由")).toBeDisabled();
  });
  it("keeps a confirmed conflict frozen if reading its current version fails", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: "ok", data: snapshot() }))
      .mockResolvedValueOnce(Response.json({ status: "error", errors: [{ code: "WEEKLY_CONFLICT", message: "版本衝突" }] }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ status: "error", errors: [{ code: "WEEKLY_FORBIDDEN", message: "目前無權讀取" }] }, { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    render(<ClientWeeklyWorkspace clientId={clientId} today={today} canManage />);
    await waitFor(() => expect(screen.getByLabelText("安排依據／異動理由")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("安排依據／異動理由"), { target: { value: "仍保留的安排" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存每週安排" }));
    await screen.findByText("安排版本已變動，請先核對");
    fireEvent.click(screen.getByRole("button", { name: "讀取目前版本供核對" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("目前無權讀取");
    expect(screen.getByLabelText("安排依據／異動理由")).toHaveValue("仍保留的安排");
    expect(screen.getByRole("button", { name: "儲存每週安排" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "採用核對版本，繼續編輯草稿" })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
