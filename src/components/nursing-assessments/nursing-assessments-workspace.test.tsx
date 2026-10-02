// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { clearNursingAssessmentPendingOnLogout, getNursingAssessmentPending, nursingAssessmentAuthoritySignature } from "@/lib/nursing-assessments/pending";
import type { NursingRequest, NursingVersion } from "@/lib/nursing-assessments/types";
import { hasViewTransition } from "@/lib/navigation/pending-operation-lock";
import { buildDemoNursingAssessmentSnapshot } from "@/lib/nursing-assessments/demo";
import { NursingAssessmentsWorkspace, NursingVersionDifferences } from "./nursing-assessments-workspace";
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const id = "51000000-0000-4000-8000-000000000001";
const demo = buildDemoNursingAssessmentSnapshot(id, id);
const formal = { ...demo, demo: false };
const version = demo.clients[0]!.versions[0]!;
const context: TenantContext = { organizationId: id, branchId: id, userId: version.recordedBy, organizationName: "合成機構", branchName: "合成分支", displayName: "合成護理員", roles: ["nurse"], scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.manage", "nursing_assessments.sign"], assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false };
const props = { context, snapshot: formal, canManage: true, canSign: true, hasRecentAal2: true, actorUserId: version.recordedBy };
let testDay = 0;
const baseTime = Date.now();
function freshAfter(offset = 1000) {
  const generatedAt = new Date(Date.parse(formal.generatedAt) + offset).toISOString();
  vi.setSystemTime(new Date(generatedAt));
  return { ...formal, generatedAt, staleAfter: new Date(Date.parse(generatedAt) + 300000).toISOString() };
}
function readSuccess(init: RequestInit) {
  return Response.json({ requestId: "51000000-0000-4000-8000-000000000090", status: "ok", errors: [],
    data: { schemaVersion: 1, organizationId: id, branchId: id, actorUserId: context.userId,
      nonce: new Headers(init.headers).get("x-nursing-read-nonce"), snapshot: formal,
      capabilities: { canManage: true, canSign: true, hasRecentAal2: true },
      authoritySignature: nursingAssessmentAuthoritySignature(context), demo: false } });
}
function sign() { fireEvent.click(screen.getByRole("button", { name: "簽署目前草稿" })); fireEvent.click(screen.getByRole("button", { name: "確認簽署" })); }
function deny(status = 403) { return Response.json({ requestId: "51000000-0000-4000-8000-000000000090", status: "error", data: null, errors: [{ code: status === 409 ? "NURSING_VERSION_CONFLICT" : "NURSING_NOT_AUTHORIZED", message: "合成拒絕" }] }, { status }); }
function signed(): NursingVersion { const at = new Date().toISOString(); return { ...structuredClone(version), versionId: "51000000-0000-4000-8000-000000000021", version: 2, previousVersionId: version.versionId, previousContentHash: version.contentHash, contentHash: "b".repeat(64), state: "signed", signedAt: at, signedBy: context.userId, signerDisplayName: "合成護理員", signaturePurpose: "人工護理評估簽署", signatureChallengeId: "51000000-0000-4000-8000-000000000022", createdAt: at }; }
function success(init: RequestInit, result = signed()) { return Response.json({ requestId: "51000000-0000-4000-8000-000000000090", status: "ok", errors: [], data: { operationId: "51000000-0000-4000-8000-000000000091", organizationId: id, branchId: id, actorUserId: context.userId, idempotencyKey: new Headers(init.headers).get("idempotency-key"), request: JSON.parse(String(init.body)) as NursingRequest, result, replayed: false, persisted: true, demo: false } }, { status: 201 }); }
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(baseTime + ++testDay * 86400000));
  formal.generatedAt = new Date().toISOString(); formal.staleAfter = new Date(Date.now() + 300000).toISOString();
  context.recentAal2At = new Date().toISOString(); clearNursingAssessmentPendingOnLogout();
});
afterEach(() => { cleanup(); clearNursingAssessmentPendingOnLogout(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("manual nursing workspace", () => {
  it("authorized managers can read without acquiring nurse-only write privileges", () => {
    render(<NursingAssessmentsWorkspace {...props} context={{ ...context, roles: ["organization_manager"] }} canManage={false} canSign={false}/>);
    expect(screen.getByRole("heading", { name: "合成個案甲" })).toBeInTheDocument(); expect(screen.getByRole("button", { name: "新增護理評估" })).toBeDisabled(); expect(screen.getByRole("button", { name: "簽署目前草稿" })).toBeDisabled();
  });
  it("actor/privacy ABA cannot reuse another actor's retained snapshot; a newer projection is required", () => {
    const { rerender } = render(<NursingAssessmentsWorkspace {...props}/>); fireEvent.click(screen.getByRole("button", { name: "修訂最新草稿" }));
    rerender(<NursingAssessmentsWorkspace {...props} context={{ ...context, userId: "51000000-0000-4000-8000-000000000014" }}/>);
    expect(screen.queryByRole("heading", { name: "合成個案甲" })).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "儲存草稿" })).not.toBeInTheDocument();
    rerender(<NursingAssessmentsWorkspace {...props}/>); expect(screen.queryByRole("heading", { name: "合成個案甲" })).not.toBeInTheDocument();
    rerender(<NursingAssessmentsWorkspace {...props} snapshot={freshAfter()}/>);
    expect(screen.getByRole("heading", { name: "合成個案甲" })).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "儲存草稿" })).not.toBeInTheDocument();
  });
  it("global logout clearing immediately redacts retained snapshot and editor", () => {
    render(<NursingAssessmentsWorkspace {...props}/>); fireEvent.click(screen.getByRole("button", { name: "修訂最新草稿" }));
    act(() => clearNursingAssessmentPendingOnLogout()); expect(screen.queryByRole("heading", { name: "合成個案甲" })).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "儲存草稿" })).not.toBeInTheDocument();
  });
  it("explicit GET owns a shared view lease, blocking writes until the read completes", async () => {
    let finish!: () => void;
    const fetch = vi.fn((_url, init: RequestInit) => new Promise<Response>((resolve) => { finish = () => resolve(readSuccess(init)); }));
    vi.stubGlobal("fetch", fetch); render(<NursingAssessmentsWorkspace {...props}/>);
    fireEvent.click(screen.getByRole("button", { name: "重新載入" })); expect(hasViewTransition()).toBe(true); expect(screen.getByRole("button", { name: "新增護理評估" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "簽署目前草稿" })); expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0]![1].method).toBe("GET"); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => finish()); expect(hasViewTransition()).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
  it("signed correction requires a valid reason and an explicit second confirmation", async () => {
    const result = signed(); const clients = structuredClone(formal.clients); clients[0]!.versions.unshift(result); clients[0]!.versionsTotal = 2;
    const fetch = vi.fn().mockRejectedValue(new TypeError("lost ACK")); vi.stubGlobal("fetch", fetch);
    render(<NursingAssessmentsWorkspace {...props} snapshot={{ ...formal, clients }}/>); fireEvent.click(screen.getByRole("button", { name: "追加更正版" }));
    fireEvent.click(screen.getByRole("button", { name: "簽署並追加更正版" })); const textarea = screen.getByRole("textbox", { name: /更正理由/u }); expect(textarea).toHaveFocus(); expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(textarea, { target: { value: "合成理由：補充觀察" } }); fireEvent.click(screen.getByRole("button", { name: "簽署並追加更正版" }));
    expect(screen.getByRole("dialog", { name: "確認更正護理評估" })).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "確認更正並簽署" })); await waitFor(() => expect(getNursingAssessmentPending().operation?.phase).toBe("unknown")); expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ action: "correct", previousVersionId: result.versionId, correctionReason: "合成理由：補充觀察" });
  });
  it.each([403, 409])("unknown followed by %i retains the fixed operation and retry key", async (status) => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("lost ACK")).mockResolvedValue(deny(status)); vi.stubGlobal("fetch", fetch);
    render(<NursingAssessmentsWorkspace {...props}/>); sign();
    await waitFor(() => expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"));
    fireEvent.click(screen.getByRole("button", { name: "重試同一護理操作" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); await waitFor(() => expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"));
    expect(fetch.mock.calls[0]![1].body).toBe(fetch.mock.calls[1]![1].body);
    expect(new Headers(fetch.mock.calls[0]![1].headers).get("idempotency-key")).toBe(new Headers(fetch.mock.calls[1]![1].headers).get("idempotency-key"));
    expect(screen.getByRole("button", { name: "新增護理評估" })).toBeDisabled(); expect(refresh).not.toHaveBeenCalled();
  });
  it("a strict first denial unlocks and shows an actionable error, unlike an unknown result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(deny())); render(<NursingAssessmentsWorkspace {...props}/>); sign();
    await waitFor(() => expect(getNursingAssessmentPending().operation).toBeNull());
    expect(screen.getByRole("alert")).toHaveTextContent("本次操作未保存"); expect(screen.getByRole("button", { name: "簽署目前草稿" })).not.toBeDisabled();
  });
  it("read permission revocation immediately hides history and old confirmation across ABA", () => {
    const { rerender } = render(<NursingAssessmentsWorkspace {...props}/>); fireEvent.click(screen.getByRole("button", { name: "簽署目前草稿" }));
    rerender(<NursingAssessmentsWorkspace {...props} context={{ ...context, scopes: context.scopes.filter((scope) => scope !== "nursing_assessments.read") }}/>);
    expect(screen.queryByText("合成個案甲")).not.toBeInTheDocument(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.queryByText(`已記錄：${version.content.domains.observations.detail}`)).not.toBeInTheDocument();
    rerender(<NursingAssessmentsWorkspace {...props}/>); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.queryByRole("heading", { name: "合成個案甲" })).not.toBeInTheDocument();
    rerender(<NursingAssessmentsWorkspace {...props} snapshot={freshAfter()}/>); expect(screen.getByRole("heading", { name: "合成個案甲" })).toBeInTheDocument();
  });
  it("removing manage permission does not hide authorized history but disables draft writes", () => {
    render(<NursingAssessmentsWorkspace {...props} canManage={false} context={{ ...context, scopes: context.scopes.filter((scope) => scope !== "nursing_assessments.manage") }}/>);
    expect(screen.getByRole("heading", { name: "合成個案甲" })).toBeInTheDocument(); expect(screen.getByRole("button", { name: "新增護理評估" })).toBeDisabled();
  });
  it("assignment disappears/restores while sending: late success cannot settle or expose the original editor", async () => {
    let complete!: (response: Response) => void; let captured!: RequestInit;
    const fetch = vi.fn((_url, init: RequestInit) => { captured = init; return new Promise<Response>((resolve) => { complete = resolve; }); }); vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<NursingAssessmentsWorkspace {...props}/>); sign();
    rerender(<NursingAssessmentsWorkspace {...props} snapshot={{ ...formal, clients: [formal.clients[1]!], clientTotal: 1 }}/>);
    expect(screen.queryByText("合成個案甲")).not.toBeInTheDocument(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<NursingAssessmentsWorkspace {...props}/>); await act(async () => complete(success(captured)));
    expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"); expect(getNursingAssessmentPending().confirmed).toHaveLength(0); expect(refresh).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("recovery survives a load error but hides payload and cannot retry without a visible assigned client", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("lost ACK")));
    const { rerender } = render(<NursingAssessmentsWorkspace {...props}/>); sign(); await waitFor(() => expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"));
    rerender(<NursingAssessmentsWorkspace {...props} snapshot={null} loadError/>);
    expect(screen.getByRole("region", { name: "護理操作回查" })).toHaveTextContent("內容已隱藏"); expect(screen.queryByRole("button", { name: "以相同內容重試" })).not.toBeInTheDocument(); expect(getNursingAssessmentPending().operation).not.toBeNull();
  });
  it("blocks draft validation inline and focuses the first invalid control without POST", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<NursingAssessmentsWorkspace {...props}/>);
    fireEvent.click(screen.getByRole("button", { name: "新增護理評估" }));
    const textarea = within(screen.getByRole("group", { name: "護理觀察" })).getByRole("textbox"); fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" })); expect(textarea).toHaveFocus(); expect(textarea).toHaveAttribute("aria-invalid", "true"); expect(textarea).toHaveAccessibleDescription(/1–1000/u); expect(fetch).not.toHaveBeenCalled(); expect(textarea.closest("form")).toHaveAttribute("novalidate");
  });
  it("uses the canonical discard dialog and respects active IME composition", () => {
    render(<NursingAssessmentsWorkspace {...props}/>); fireEvent.click(screen.getByRole("button", { name: "修訂最新草稿" }));
    const textarea = within(screen.getByRole("group", { name: "護理觀察" })).getByRole("textbox"); fireEvent.change(textarea, { target: { value: "合成編輯" } });
    fireEvent.compositionStart(textarea); fireEvent.click(screen.getByRole("button", { name: "取消編輯" })); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.compositionEnd(textarea); fireEvent.click(screen.getByRole("button", { name: "取消編輯" })); expect(screen.getByRole("dialog", { name: "放棄未保存的護理編輯？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "繼續編輯" })); expect(screen.getByRole("button", { name: "儲存草稿" })).toBeInTheDocument();
  });
  it("expired real recency blocks signing despite a stale true capability flag", () => {
    render(<NursingAssessmentsWorkspace {...props} context={{ ...context, recentAal2At: new Date(Date.now() - 16 * 60_000).toISOString() }}/>);
    expect(screen.getByRole("button", { name: "簽署目前草稿" })).toBeDisabled(); expect(screen.getByRole("button", { name: "新增護理評估" })).not.toBeDisabled();
  });
  it("confirmation never rebases an original sign onto a newer source snapshot", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const { rerender } = render(<NursingAssessmentsWorkspace {...props}/>);
    fireEvent.click(screen.getByRole("button", { name: "簽署目前草稿" })); rerender(<NursingAssessmentsWorkspace {...props} snapshot={freshAfter()}/>);
    fireEvent.click(screen.getByRole("button", { name: "確認簽署" })); expect(fetch).not.toHaveBeenCalled(); expect(screen.getAllByRole("alert")[0]).toHaveTextContent("畫面版本或授權已更新");
  });
  it("valid receipt saves but same-client writes remain blocked until a positive newer snapshot proves the exact chain", async () => {
    const result = signed(); const fetch = vi.fn((_url, init: RequestInit) => Promise.resolve(success(init, result))); vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<NursingAssessmentsWorkspace {...props}/>); sign(); await waitFor(() => expect(getNursingAssessmentPending().confirmed).toHaveLength(1));
    expect(screen.getByText(/清單尚未確認更新/u)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "新增護理評估" })).toBeDisabled();
    vi.setSystemTime(new Date(Date.parse(result.createdAt) + 1));
    rerender(<NursingAssessmentsWorkspace {...props} snapshot={freshAfter(1)}/>);
    expect(getNursingAssessmentPending().confirmed).toHaveLength(1); expect(screen.queryByText("護理操作已保存，清單已確認更新。")).not.toBeInTheDocument();
    const clients = structuredClone(formal.clients); clients[0]!.versions.unshift(result); clients[0]!.versionsTotal = 2;
    rerender(<NursingAssessmentsWorkspace {...props} snapshot={{ ...freshAfter(2), clients }}/ >);
    await waitFor(() => expect(getNursingAssessmentPending().confirmed).toHaveLength(0)); expect(screen.getByText("護理操作已保存，清單已確認更新。")).toBeInTheDocument(); expect(screen.getByRole("button", { name: "新增護理評估" })).not.toBeDisabled();
  });
  it("GREEN retains unknown operation across workspace remount without another POST", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("synthetic lost ACK")); vi.stubGlobal("fetch", fetch);
    const view = render(<NursingAssessmentsWorkspace {...props} {...{ context }}/>);
    fireEvent.click(screen.getByRole("button", { name: "簽署目前草稿" }));
    const confirm = screen.queryByRole("button", { name: "確認簽署" }); if (confirm) fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole("button", { name: "以相同內容重試" })).not.toBeDisabled());
    view.unmount(); render(<NursingAssessmentsWorkspace {...props} {...{ context }}/>);
    expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeInTheDocument(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("GREEN sign requires explicit canonical confirmation before POST", () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("synthetic")); vi.stubGlobal("fetch", fetch);
    render(<NursingAssessmentsWorkspace {...props} {...{ context }}/>);
    fireEvent.click(screen.getByRole("button", { name: "簽署目前草稿" }));
    expect(fetch).not.toHaveBeenCalled(); expect(screen.getByRole("dialog", { name: "確認簽署護理評估" })).toBeInTheDocument();
  });
  it("shows manual form version and synthetic read-only restrictions", () => {
    render(<NursingAssessmentsWorkspace {...props} context={{ ...context, demo: true }} snapshot={demo}/>);
    expect(screen.getByRole("button", { name: "新增護理評估" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "簽署目前草稿" })).toBeDisabled();
    expect(screen.getByText(/manual-nursing-v1/)).toBeInTheDocument();
    expect(screen.getByText(/官方量表計分、附件、匯出、通知與離線同步：尚未設定/)).toBeInTheDocument();
  });
  it("blocks signing without recent AAL2 but permits drafts", () => {
    render(<NursingAssessmentsWorkspace {...props} hasRecentAal2={false}/>);
    expect(screen.getByRole("button", { name: "簽署目前草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "新增護理評估" })).not.toBeDisabled();
  });
  it("keeps a selected client when opened from the assessment entry", () => {
    const selected = demo.clients[1]!;
    render(<NursingAssessmentsWorkspace {...props} initialClientId={selected.clientId}/>);
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveValue(selected.clientId);
    expect(screen.getByRole("heading", { name: selected.displayName })).toBeInTheDocument();
  });
  it("does not fall back to a different client for an out-of-scope selected id", () => {
    render(<NursingAssessmentsWorkspace {...props} initialClientId="51000000-0000-4000-8000-000000000099"/>);
    expect(screen.getByRole("alert")).toHaveTextContent("不在目前可查看範圍");
    expect(screen.queryByRole("button", { name: "新增護理評估" })).not.toBeInTheDocument();
  });
  it("shows prior/current differences and explicit missing state", () => {
    const current = structuredClone(version); current.version = 2;
    current.content.domains.observations.detail = "合成觀察更新";
    render(<NursingVersionDifferences previous={version} current={current}/>);
    expect(screen.getByText("前版")).toBeInTheDocument(); expect(screen.getByText("本版")).toBeInTheDocument();
    expect(screen.getByText(/合成觀察更新/)).toBeInTheDocument();
  });
  it("does not refresh on ambiguous success and retries exact request/key", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ status: "ok", data: {} }) });
    vi.stubGlobal("fetch", fetch); render(<NursingAssessmentsWorkspace {...props}/>);
    fireEvent.click(screen.getByRole("button", { name: "簽署目前草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "確認簽署" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "以相同內容重試" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "以相同內容重試" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[0]![1].body).toBe(fetch.mock.calls[1]![1].body);
    expect(fetch.mock.calls[0]![1].headers["idempotency-key"]).toBe(fetch.mock.calls[1]![1].headers["idempotency-key"]);
    expect(refresh).not.toHaveBeenCalled();
  });
  it("never displays demo fallback when real load fails", () => {
    render(<NursingAssessmentsWorkspace {...props} snapshot={null} loadError/>);
    expect(screen.getByRole("alert")).toHaveTextContent("護理評估暫時無法載入");
    expect(screen.queryByText("合成個案甲")).not.toBeInTheDocument();
  });
  it("does not silently rebase an open draft editor onto a refreshed snapshot", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<NursingAssessmentsWorkspace {...props}/>);
    fireEvent.click(screen.getByRole("button", { name: "修訂最新草稿" }));
    rerender(<NursingAssessmentsWorkspace {...props} snapshot={freshAfter()}/>);
    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));
    expect(screen.getByRole("alert")).toHaveTextContent("畫面版本已更新");
    expect(fetch).not.toHaveBeenCalled();
  });
});
