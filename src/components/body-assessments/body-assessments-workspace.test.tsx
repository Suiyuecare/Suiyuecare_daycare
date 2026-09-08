// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffPages } from "@/lib/catalog";
import { buildDemoBodyAssessmentSnapshot } from "@/lib/body-assessments/demo";
import { BodyAssessmentsWorkspace } from "./body-assessments-workspace";
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const page = staffPages.find((p) => p.number === 19)!;
const demo = buildDemoBodyAssessmentSnapshot({ clientId: null, state: "all" });
const actor = demo.records[0].actor_user_id;
function view(snapshot = demo) { return render(<BodyAssessmentsWorkspace page={page} snapshot={snapshot} canManage canSign actorUserId={actor} />); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("body observation workspace", () => {
  it("shows synthetic detail and prior observations while disabling mutations", () => {
    view(); expect(screen.getByRole("button", { name: "新增評估草稿" })).toBeDisabled();
    expect(screen.getByText(/唯讀展示模式/)).toBeInTheDocument();
    expect(screen.getByText(/照片／附件服務尚未設定/)).toBeInTheDocument();
    expect(screen.getByText(/未列出的部位不代表已評估或正常/)).toBeInTheDocument();
    expect(screen.getByText(/紀錄詳情與版本歷程/).closest("details")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "第 1 版 · 草稿待簽" })).toBeInTheDocument();
  });
  it("starts without preselected observations and points to actual staff MFA route", () => {
    view({ ...demo, demo: false });
    expect(screen.getByRole("link", { name: "重新完成雙因素驗證" })).toHaveAttribute("href", "/mfa?audience=staff");
    fireEvent.click(screen.getByRole("button", { name: "新增評估草稿" }));
    expect(screen.queryByLabelText("觀察狀態")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加入觀察部位" }));
    expect(screen.getByLabelText("觀察狀態")).toHaveValue(""); expect(screen.getByLabelText("部位")).toHaveValue("");
  });
  it("fails closed for incomplete snapshot options", () => {
    view({ ...demo, demo: false, clientsTruncated: true });
    expect(screen.getByRole("button", { name: "新增評估草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "建立更正版" })).toBeDisabled();
  });
  it("keeps exact body and operation key after uncertain network result", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network")); vi.stubGlobal("fetch", fetch);
    const record = demo.records[0].history[0];
    view({ ...demo, demo: false, records: [{ ...record, history: [], historyTotal: 0, historyTruncated: false }] });
    fireEvent.click(screen.getByRole("button", { name: "核對並簽署" }));
    fireEvent.click(screen.getByRole("button", { name: "本人確認已核對所選部位的人工觀察與處置" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "重試相同操作" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "重試相同操作" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
    expect(fetch.mock.calls[0][1].headers["idempotency-key"]).toBe(fetch.mock.calls[1][1].headers["idempotency-key"]);
    expect(screen.getByRole("button", { name: "新增評估草稿" })).toBeDisabled();
  });
  it("known stale-version rejection permits refreshing instead of trapping retries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ status: "error", data: null,
      errors: [{ code: "BODY_ASSESSMENT_VERSION_CONFLICT" }] }) }));
    const record = demo.records[0].history[0];
    view({ ...demo, demo: false, records: [{ ...record, history: [], historyTotal: 0, historyTruncated: false }] });
    fireEvent.click(screen.getByRole("button", { name: "核對並簽署" }));
    fireEvent.click(screen.getByRole("button", { name: "本人確認已核對所選部位的人工觀察與處置" }));
    await waitFor(() => expect(screen.getByText(/本次操作未接受/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "重新載入" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "重試相同操作" })).not.toBeInTheDocument();
  });
});
