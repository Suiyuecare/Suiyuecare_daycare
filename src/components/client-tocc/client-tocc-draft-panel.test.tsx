// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { CoreDraftGuardHost } from "@/components/app/core-draft-guard";

const stubs = vi.hoisted(() => ({ fetchWithTimeout: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/api/client-fetch", () => ({ fetchWithTimeout: stubs.fetchWithTimeout }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: stubs.refresh }) }));

import { ClientToccDraftPanel } from "./client-tocc-draft-panel";

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});

function GuardedPanel(props: ComponentProps<typeof ClientToccDraftPanel>) {
  return <><CoreDraftGuardHost /><ClientToccDraftPanel {...props} /></>;
}

const clientId = "e0800000-0000-4000-8000-000000000001";
const draftKey = "e0900000-0000-4000-8000-000000000001";
const versionId = "e0900000-0000-4000-8000-000000000002";
const hash = "a".repeat(64);
const clients = [{ id: clientId, code: "TOCC-1", name: "測試個案", clientStatus: "active" as const,
  admittedOn: "2026-01-01", endedOn: null, canRecord: true }];
const draft = {
  draftKey, versionId, clientId, version: 1, contentHash: hash,
  assessmentDate: "2026-10-03", resultStatus: "clear" as const,
  symptomSummary: null, riskSummary: null, evidenceStatus: "not_required" as const,
  actionStatus: "none_required" as const, createdAt: "2026-10-03T10:00:00Z",
  signedAssessmentId: null,
};
const requestId = "e0a00000-0000-4000-8000-000000000099";

function desktopList() {
  return within(screen.getByRole("region", { name: "TOCC 草稿列表，可左右捲動" }));
}

function mobileList() {
  return within(screen.getByTestId("tocc-draft-mobile-list"));
}

beforeEach(() => {
  stubs.fetchWithTimeout.mockReset();
  stubs.refresh.mockReset();
});
afterEach(cleanup);

describe("TOCC draft panel", () => {
  it("shows unsigned drafts separately and lets approved AAL1 staff revise without a sign action", async () => {
    stubs.fetchWithTimeout.mockResolvedValue(Response.json({
      requestId, status: "ok", errors: [],
      data: { draftKey, versionId: "e0900000-0000-4000-8000-000000000003",
        clientId, version: 2, contentHash: "b".repeat(64), replayed: false },
    }, { status: 201 }));
    render(<GuardedPanel drafts={[draft]} clients={clients} today="2026-10-03"
      canSave canSign={false} />);
    expect(screen.getByText(/不計入下方正式 TOCC 效期/)).toBeTruthy();
    expect(desktopList().getByText("未簽署")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /簽署 v1/ })).toBeNull();
    fireEvent.click(desktopList().getByRole("button", { name: "修訂" }));
    expect(screen.getByRole("heading", { name: "修訂未簽署草稿 v1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "儲存未簽署草稿" }).closest("form")?.method).toBe("post");
    fireEvent.change(screen.getByLabelText(/症狀摘要/), { target: { value: "人工觀察" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存未簽署草稿" }));
    await waitFor(() => expect(stubs.fetchWithTimeout).toHaveBeenCalledOnce());
    const [url, request] = stubs.fetchWithTimeout.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/client-tocc/drafts");
    const payload = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({ action: "revise", draft_key: draftKey,
      previous_version_id: versionId, expected_version: 1,
      expected_content_hash: hash, symptom_summary: "人工觀察" });
    await waitFor(() => expect(screen.getByText("未簽署草稿 v2 已儲存。")).toBeTruthy());
    expect(stubs.refresh).toHaveBeenCalledOnce();
  });

  it("requires a full review before an AAL2 signer submits the frozen version and hash", async () => {
    stubs.fetchWithTimeout.mockResolvedValue(Response.json({
      requestId, status: "ok", errors: [],
      data: { draftKey, versionId,
        assessmentId: "e0800000-0000-4000-8000-000000000009", replayed: false },
    }, { status: 201 }));
    render(<GuardedPanel drafts={[{ ...draft, resultStatus: "monitor",
      symptomSummary: "發燒", riskSummary: "接觸史待確認", evidenceStatus: "pending",
      actionStatus: "in_progress" }]} clients={clients} today="2026-10-03"
      canSave={false} canSign />);
    expect(screen.queryByRole("button", { name: "建立草稿" })).toBeNull();
    fireEvent.click(desktopList().getByRole("button", { name: "核對草稿 v1" }));
    expect(stubs.fetchWithTimeout).not.toHaveBeenCalled();
    const review = screen.getByRole("region", { name: "正式簽署前核對草稿 v1" });
    expect(within(review).getByText("發燒")).toBeTruthy();
    expect(within(review).getByText("接觸史待確認")).toBeTruthy();
    expect(within(review).getByText("證明待確認")).toBeTruthy();
    expect(within(review).getByText("處置中")).toBeTruthy();
    fireEvent.click(within(review).getByRole("button", { name: "確認並簽署 v1" }));
    await waitFor(() => expect(stubs.fetchWithTimeout).toHaveBeenCalledOnce());
    const [url, request] = stubs.fetchWithTimeout.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/client-tocc/drafts/sign");
    expect(JSON.parse(String(request.body))).toEqual({ draft_key: draftKey,
      expected_version_id: versionId, expected_version: 1,
      expected_content_hash: hash });
    await waitFor(() => expect(stubs.refresh).toHaveBeenCalledOnce());
  });

  it("never offers revise or sign actions on a signed draft", () => {
    render(<GuardedPanel drafts={[{ ...draft,
      signedAssessmentId: "e0800000-0000-4000-8000-000000000009" }]}
      clients={clients} today="2026-10-03" canSave canSign />);
    expect(desktopList().getByText("已轉為正式簽署紀錄")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "修訂" })).toBeNull();
    expect(screen.queryByRole("button", { name: /簽署 v1/ })).toBeNull();
  });

  it("renders actionable mobile cards and converts UTC creation time to Taipei", () => {
    render(<GuardedPanel drafts={[{ ...draft, createdAt: "2026-10-03T17:30:00Z" }]}
      clients={clients} today="2026-10-04" canSave canSign />);
    expect(mobileList().getByRole("heading", { name: "測試個案" })).toBeTruthy();
    expect(mobileList().getByText(/建立於 2026\/10\/04 01:30/)).toBeTruthy();
    expect(mobileList().getByRole("button", { name: "修訂" })).toBeTruthy();
    expect(mobileList().getByRole("button", { name: "核對草稿 v1" })).toBeTruthy();
    expect(desktopList().getByText(/建立於 2026\/10\/04 01:30/)).toBeTruthy();
  });

  it("protects an unsaved revision when cancelling or switching to another draft", async () => {
    render(<GuardedPanel drafts={[draft]} clients={clients} today="2026-10-03" canSave canSign={false} />);
    fireEvent.click(desktopList().getByRole("button", { name: "修訂" }));
    fireEvent.change(screen.getByLabelText(/症狀摘要/), { target: { value: "尚未儲存的觀察" } });
    expect(screen.getByText(/切換草稿、站內連結、篩選或離頁時會要求確認/)).toBeTruthy();
    const leaving = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(leaving)).toBe(false);
    expect(leaving.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    const dialog = screen.getByRole("alertdialog", { name: "放棄未儲存的輸入？" });
    expect((screen.getByLabelText(/症狀摘要/) as HTMLTextAreaElement).value).toBe("尚未儲存的觀察");
    fireEvent.click(within(dialog).getByRole("button", { name: "繼續填寫" }));
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    fireEvent.click(screen.getByRole("button", { name: "建立草稿" }));
    expect(screen.getByRole("heading", { name: "修訂未簽署草稿 v1" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "放棄未儲存的輸入？" }))
      .getByRole("button", { name: "放棄本次輸入" }));
    expect(screen.getByRole("heading", { name: "建立未簽署草稿" })).toBeTruthy();
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
  });

  it("uses the app guard for GET filters while a dirty POST save still reaches the API", async () => {
    stubs.fetchWithTimeout.mockResolvedValue(Response.json({
      requestId, status: "ok", errors: [],
      data: { draftKey, versionId: "e0900000-0000-4000-8000-000000000003",
        clientId, version: 2, contentHash: "b".repeat(64), replayed: false },
    }, { status: 201 }));
    render(<><GuardedPanel drafts={[draft]} clients={clients} today="2026-10-03" canSave canSign={false} />
      <form action="/app/client-tocc" method="get" noValidate><button type="submit">套用篩選</button></form></>);
    fireEvent.click(desktopList().getByRole("button", { name: "修訂" }));
    fireEvent.change(screen.getByLabelText(/症狀摘要/), { target: { value: "人工觀察" } });
    const filter = screen.getByRole("button", { name: "套用篩選" }).closest("form")!;
    fireEvent.submit(filter);
    expect(screen.getByRole("alertdialog", { name: "放棄未儲存的內容並離開？" })).toHaveAttribute("open");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "繼續填寫" }));
    fireEvent.click(screen.getByRole("button", { name: "儲存未簽署草稿" }));
    await waitFor(() => expect(stubs.fetchWithTimeout).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText("未簽署草稿 v2 已儲存。")).toBeTruthy());
  });

  it("keeps non-recordable clients read-only with a reason on desktop and mobile", () => {
    render(<GuardedPanel drafts={[draft]} clients={[{ ...clients[0]!, canRecord: false }]}
      today="2026-10-03" canSave canSign />);
    expect(desktopList().getByText(/個案目前不可新增或修訂 TOCC/)).toBeTruthy();
    expect(mobileList().getByText(/個案目前不可新增或修訂 TOCC/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "修訂" })).toBeNull();
    expect(screen.queryByRole("button", { name: "核對草稿 v1" })).toBeNull();
  });

  it("preserves a conflicted edit, permits copying, then rebases only after reviewing the new version", async () => {
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboardWrite } });
    stubs.fetchWithTimeout.mockResolvedValueOnce(Response.json({
      requestId, status: "error", data: null,
      errors: [{ code: "TOCC_DRAFT_VERSION_CONFLICT", message: "草稿已有新版本，請重新載入。" }],
    }, { status: 409 })).mockResolvedValueOnce(Response.json({
      requestId, status: "ok", errors: [],
      data: { draftKey, versionId: "e0900000-0000-4000-8000-000000000004",
        clientId, version: 3, contentHash: "c".repeat(64), replayed: false },
    }, { status: 201 }));
    const view = render(<GuardedPanel drafts={[draft]} clients={clients} today="2026-10-03" canSave canSign={false} />);
    fireEvent.click(desktopList().getByRole("button", { name: "修訂" }));
    fireEvent.change(screen.getByLabelText(/症狀摘要/), { target: { value: "我目前的觀察" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存未簽署草稿" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "草稿版本衝突處理" })).toBeTruthy());
    expect((screen.getByLabelText(/症狀摘要/) as HTMLTextAreaElement).value).toBe("我目前的觀察");
    expect((screen.getByRole("button", { name: "儲存未簽署草稿" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("alertdialog", { name: "放棄未儲存的輸入？" })).toHaveAttribute("open");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "繼續填寫" }));
    fireEvent.click(screen.getByRole("button", { name: "複製目前輸入（含健康摘要）" }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith(expect.stringContaining("我目前的觀察")));
    fireEvent.click(screen.getByRole("button", { name: "重新載入最新草稿" }));
    expect(stubs.refresh).toHaveBeenCalledOnce();
    const latest = { ...draft, version: 2, versionId: "e0900000-0000-4000-8000-000000000003",
      contentHash: "b".repeat(64), symptomSummary: "同事的觀察" };
    view.rerender(<GuardedPanel drafts={[latest]} clients={clients} today="2026-10-03" canSave canSign={false} />);
    expect(screen.getByText("同事的觀察")).toBeTruthy();
    expect((screen.getByLabelText(/症狀摘要/) as HTMLTextAreaElement).value).toBe("我目前的觀察");
    fireEvent.click(screen.getByRole("button", { name: "保留目前輸入並改以 v2 修訂" }));
    fireEvent.click(screen.getByRole("button", { name: "儲存未簽署草稿" }));
    await waitFor(() => expect(stubs.fetchWithTimeout).toHaveBeenCalledTimes(2));
    const second = stubs.fetchWithTimeout.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(second[1].body))).toMatchObject({ previous_version_id: latest.versionId,
      expected_version: 2, expected_content_hash: latest.contentHash,
      symptom_summary: "我目前的觀察" });
  });

  it("holds an uncertain save, blocks local and page navigation, and retries identical input with its original key", async () => {
    stubs.fetchWithTimeout.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(Response.json({
      requestId, status: "ok", errors: [],
      data: { draftKey, versionId: "e0900000-0000-4000-8000-000000000003",
        clientId, version: 2, contentHash: "b".repeat(64), replayed: true },
    }, { status: 200 }));
    render(<><GuardedPanel drafts={[draft]} clients={clients} today="2026-10-03" canSave canSign={false} />
      <a href="?drafts=2">草稿下一頁</a></>);
    fireEvent.click(desktopList().getByRole("button", { name: "修訂" }));
    fireEvent.change(screen.getByLabelText(/症狀摘要/), { target: { value: "不可遺失的內容" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存未簽署草稿" }));
    await waitFor(() => expect(screen.getByText(/本次操作內容與冪等鍵已鎖定/)).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("草稿送出結果未確認");
    expect(screen.getByRole("alert").textContent).not.toContain("timeout");
    expect(screen.getByLabelText(/症狀摘要/)).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("heading", { name: "修訂未簽署草稿 v1" })).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const leaving = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    screen.getByRole("link", { name: "草稿下一頁" }).dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "以原操作重試儲存" }));
    await waitFor(() => expect(stubs.fetchWithTimeout).toHaveBeenCalledTimes(2));
    const first = stubs.fetchWithTimeout.mock.calls[0] as [string, RequestInit];
    const second = stubs.fetchWithTimeout.mock.calls[1] as [string, RequestInit];
    expect(first[1].body).toBe(second[1].body);
    expect((first[1].headers as Record<string, string>)["Idempotency-Key"])
      .toBe((second[1].headers as Record<string, string>)["Idempotency-Key"]);
    await waitFor(() => expect(screen.getByText("未簽署草稿 v2 已儲存。")).toBeTruthy());
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
  });

  it("keeps the same save operation after a malformed success receipt", async () => {
    stubs.fetchWithTimeout.mockResolvedValueOnce(Response.json({
      requestId, status: "ok", errors: [], data: { draftKey, versionId },
    }, { status: 201 })).mockResolvedValueOnce(Response.json({
      requestId, status: "ok", errors: [],
      data: { draftKey, versionId: "e0900000-0000-4000-8000-000000000003",
        clientId, version: 2, contentHash: "b".repeat(64), replayed: true },
    }, { status: 200 }));
    render(<GuardedPanel drafts={[draft]} clients={clients} today="2026-10-03" canSave canSign={false} />);
    fireEvent.click(desktopList().getByRole("button", { name: "修訂" }));
    fireEvent.change(screen.getByLabelText(/症狀摘要/), { target: { value: "保留原內容" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存未簽署草稿" }));
    await waitFor(() => expect(screen.getByText(/本次操作內容與冪等鍵已鎖定/)).toBeTruthy());
    expect(screen.getByLabelText(/症狀摘要/)).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "以原操作重試儲存" }));
    await waitFor(() => expect(stubs.fetchWithTimeout).toHaveBeenCalledTimes(2));
    const first = stubs.fetchWithTimeout.mock.calls[0] as [string, RequestInit];
    const second = stubs.fetchWithTimeout.mock.calls[1] as [string, RequestInit];
    expect(first[1].body).toBe(second[1].body);
    expect((first[1].headers as Record<string, string>)["Idempotency-Key"])
      .toBe((second[1].headers as Record<string, string>)["Idempotency-Key"]);
    await waitFor(() => expect(screen.getByText("未簽署草稿 v2 已儲存。")).toBeTruthy());
  });

  it("retries an uncertain signature with the same operation key", async () => {
    stubs.fetchWithTimeout.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(Response.json({
      requestId, status: "ok", errors: [],
      data: { draftKey, versionId,
        assessmentId: "e0800000-0000-4000-8000-000000000009", replayed: true },
    }, { status: 200 }));
    const view = render(<GuardedPanel drafts={[draft]} clients={clients} today="2026-10-03" canSave={false} canSign />);
    fireEvent.click(desktopList().getByRole("button", { name: "核對草稿 v1" }));
    fireEvent.click(screen.getByRole("button", { name: "確認並簽署 v1" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("簽署結果未確認"));
    expect(screen.getByRole("alert").textContent).not.toContain("timeout");
    fireEvent.click(screen.getByRole("button", { name: "返回草稿" }));
    expect(screen.getByRole("heading", { name: "正式簽署前核對草稿 v1" })).toBeTruthy();
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    view.rerender(<GuardedPanel drafts={[{ ...draft, version: 2,
      versionId: "e0900000-0000-4000-8000-000000000003", contentHash: "b".repeat(64) }]}
      clients={clients} today="2026-10-03" canSave={false} canSign />);
    expect(screen.getByText(/清單中的版本已變動/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "以原操作重試簽署 v1" }));
    await waitFor(() => expect(stubs.fetchWithTimeout).toHaveBeenCalledTimes(2));
    const first = stubs.fetchWithTimeout.mock.calls[0] as [string, RequestInit];
    const second = stubs.fetchWithTimeout.mock.calls[1] as [string, RequestInit];
    expect((first[1].headers as Record<string, string>)["Idempotency-Key"])
      .toBe((second[1].headers as Record<string, string>)["Idempotency-Key"]);
    await waitFor(() => expect(stubs.refresh).toHaveBeenCalledOnce());
  });
});
