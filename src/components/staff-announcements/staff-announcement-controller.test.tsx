// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { buildDemoStaffAnnouncementSnapshot } from "@/lib/staff-announcements/demo";
import { clearStaffAnnouncementPendingOnLogout, getStaffAnnouncementPending } from "@/lib/staff-announcements/pending";
import { hasPendingOperations, tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import type { StaffAnnouncementItem, StaffAnnouncementSnapshot } from "@/lib/staff-announcements/types";
import { StaffAnnouncementController } from "./staff-announcement-controller";
import { StaffAnnouncementDraftAction, StaffAnnouncementPublishAction, StaffAnnouncementReadAction, StaffAnnouncementWithdrawAction } from "./staff-announcement-actions";

const refresh = vi.fn(); vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const uuid = (number: number) => `68000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const context: TenantContext = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3), organizationName: "合成機構", branchName: "合成分支", displayName: "合成主管",
  roles: ["branch_director"], scopes: ["announcements.read", "announcements.manage", "announcements.publish"], assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false };
const staff = [{ userId: uuid(4), displayName: "合成社工", employeeCode: "S-001", profileKind: "staff" as const }];
const draft: StaffAnnouncementItem = { versionId: uuid(5), announcementKey: uuid(6), version: 1, versionState: "draft", title: "合成原草稿", body: "原始內容", publishAt: "2026-09-26T00:00:00.000Z", expiresAt: null,
  lifecycle: "draft", hasPendingDraft: true, audienceUserIds: [uuid(4)], audienceRoleIds: [], activeReleaseVersionId: null, activeReleaseVersion: null, activeReleaseTitle: null, activeReleaseBody: null,
  activeReleasePublishAt: null, activeReleaseExpiresAt: null, recipientCount: 0, readCount: 0, unreadCount: 0, actorIsRecipient: false, actorReadAt: null, withdrawalReason: null };
const published: StaffAnnouncementItem = { ...draft, versionId: uuid(7), version: 3, title: "私人待發布草稿", lifecycle: "published", activeReleaseVersionId: uuid(8), activeReleaseVersion: 2,
  activeReleaseTitle: "原發布公告", activeReleaseBody: "發布內容", activeReleasePublishAt: draft.publishAt, activeReleaseExpiresAt: null, recipientCount: 1, unreadCount: 1, actorIsRecipient: true };
function snapshot(items: readonly StaffAnnouncementItem[] = [draft]): StaffAnnouncementSnapshot {
  const base = buildDemoStaffAnnouncementSnapshot({ organizationId: context.organizationId, branchId: context.branchId, selectedReleaseId: null });
  return { ...base, demo: false, canManage: true, generatedAt: new Date(Date.now() - 1000).toISOString(), staleAfter: new Date(Date.now() + 60_000).toISOString(),
    items, availableTotal: items.length, itemsTruncated: false, audienceStaff: staff, audienceRoles: [], selectedAnnouncement: null, selectedReleaseId: null,
    pagination: { page: 1, pageSize: 20, matchingTotal: items.length, totalPages: 1, rangeStart: items.length ? 1 : 0, rangeEnd: items.length } };
}
type Props = { actor?: TenantContext; source?: StaffAnnouncementSnapshot | null; item?: StaffAnnouncementItem; kind?: "draft" | "publish" | "withdraw" | "read"; canPublish?: boolean; recent?: boolean; canRead?: boolean; row?: boolean };
function View({ actor = context, source = snapshot(), item, kind = "draft", canPublish = true, recent = true, canRead = true, row = true }: Props) {
  return <StaffAnnouncementController context={actor} snapshot={source} canPublish={canPublish} hasRecentAal2={recent} canRead={canRead}>
    <section><h1 data-governance-focus-anchor tabIndex={-1}>公告管理</h1>{row && (kind === "draft" ? <StaffAnnouncementDraftAction item={item} staff={staff} roles={[]} canManage demo={false} />
      : kind === "publish" ? <StaffAnnouncementPublishAction item={item!} canPublish={canPublish} hasRecentAal2={recent} demo={false} generatedAt={source?.generatedAt ?? ""} />
        : kind === "withdraw" ? <StaffAnnouncementWithdrawAction item={item!} canPublish={canPublish} hasRecentAal2={recent} demo={false} generatedAt={source?.generatedAt ?? ""} />
          : <StaffAnnouncementReadAction item={item!} enabled demo={false} />)}<a href="/another-synthetic-page">其他頁面</a></section>
  </StaffAnnouncementController>;
}
function response(data: unknown, status = 201) { return Response.json({ requestId: uuid(90), status: "ok", data, errors: [] }, { status }); }
function denial() { return Response.json({ requestId: uuid(90), status: "error", data: null, errors: [{ code: "STAFF_ANNOUNCEMENT_NOT_AUTHORIZED", message: "合成拒絕" }] }, { status: 403 }); }
function receipt(action: string, wire: Record<string, unknown>, item?: StaffAnnouncementItem) {
  const common = { announcementKey: item?.announcementKey ?? uuid(20), persisted: true, demo: false, replayed: false };
  return action === "draft" ? { ...common, action, versionId: uuid(21), version: item ? item.version + 1 : 1, previousVersionId: wire.previous_version_id, versionState: "draft", publishAt: wire.publish_at, expiresAt: wire.expires_at }
    : action === "publish" ? { ...common, action, versionId: uuid(21), version: item!.version + 1, draftVersionId: wire.draft_version_id, lifecycle: "published", publishAt: item!.publishAt, expiresAt: item!.expiresAt, recipientCount: 1 }
      : action === "withdraw" ? { ...common, action, versionId: uuid(21), version: item!.version + 1, previousVersionId: wire.expected_latest_version_id, releaseVersionId: wire.release_version_id, lifecycle: "withdrawn", reason: wire.reason, withdrawnAt: new Date().toISOString() }
        : { ...common, action, releaseVersionId: wire.release_version_id, readAt: new Date().toISOString() };
}
function successfulFetch(item?: StaffAnnouncementItem) { return vi.fn(async (_url, init: RequestInit) => response(receipt(new Headers(init.headers).get("x-announcement-action")!, JSON.parse(String(init.body)), item))); }
function complete(dialog: HTMLElement, revision = false) {
  fireEvent.change(within(dialog).getByLabelText("標題 *"), { target: { value: "合成測試公告" } });
  fireEvent.change(within(dialog).getByLabelText("內容 *"), { target: { value: "合成內容，非真實個資。" } });
  fireEvent.change(within(dialog).getByLabelText("發布時間（Asia/Taipei）*"), { target: { value: "2026-09-26T08:00" } });
  fireEvent.change(within(dialog).getByLabelText("到期設定 *"), { target: { value: "none" } });
  const checkbox = within(dialog).getByRole("checkbox", { name: /合成社工/u }) as HTMLInputElement;
  if (!checkbox.checked) fireEvent.click(checkbox);
  if (revision) fireEvent.change(within(dialog).getByLabelText(/修改理由/u), { target: { value: "合成更正原因" } });
}
function openDraft() { fireEvent.click(screen.getByRole("button", { name: /建立公告|建立新版/u })); return screen.getByRole("dialog", { name: "建立公告草稿" }); }
function submitDraft(dialog: HTMLElement) { fireEvent.click(within(dialog).getByRole("button", { name: "建立不可變草稿" })); }
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
beforeEach(() => { clearStaffAnnouncementPendingOnLogout(); refresh.mockReset(); });
afterEach(() => { cleanup(); clearStaffAnnouncementPendingOnLogout(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("workspace announcement controller", () => {
  it("GREEN preserves the lost-ACK draft, disables editing/Cancel, and never silently resends", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("synthetic lost ACK")); vi.stubGlobal("fetch", fetch);
    render(<View />); const dialog = openDraft(); complete(dialog); submitDraft(dialog);
    await waitFor(() => expect(getStaffAnnouncementPending().operation?.phase).toBe("unknown"));
    expect(within(dialog).getByLabelText("標題 *").closest("fieldset")?.hasAttribute("disabled")).toBe(true);
    expect(within(dialog).getByRole("button", { name: "取消" }).hasAttribute("disabled")).toBe(true);
    fireEvent(dialog, new Event("cancel", { cancelable: true, bubbles: false })); expect(dialog.hasAttribute("open")).toBe(true); expect(fetch).toHaveBeenCalledTimes(1); expect(hasPendingOperations()).toBe(true);
  });
  it("GREEN recovery survives row disappearance, null snapshots, and provider remount", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("lost ACK")));
    const first = render(<View />); const dialog = openDraft(); complete(dialog); submitDraft(dialog);
    await waitFor(() => expect(getStaffAnnouncementPending().operation?.phase).toBe("unknown")); const frozen = getStaffAnnouncementPending().operation!;
    first.unmount(); render(<View source={null} row={false} />);
    expect(screen.getAllByText(/上次公告操作尚未確認/u).length).toBeGreaterThan(0); fireEvent.click(screen.getByRole("button", { name: "回查上次公告操作" }));
    expect((screen.getByLabelText("標題 *") as HTMLInputElement).value).toBe("合成測試公告");
    expect(getStaffAnnouncementPending().operation!.body).toBe(frozen.body); expect(getStaffAnnouncementPending().operation!.input.idempotencyKey).toBe(frozen.input.idempotencyKey);
  });
  it("offers a view-only return without abandoning the unknown operation or lease", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("lost ACK"))); render(<View />); const dialog = openDraft(); complete(dialog); submitDraft(dialog);
    await waitFor(() => expect(getStaffAnnouncementPending().operation?.phase).toBe("unknown"));
    fireEvent.click(within(dialog).getByRole("button", { name: "回待確認清單" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); expect(hasPendingOperations()).toBe(true);
    expect(screen.getByRole("button", { name: "回查上次公告操作" })).toBeTruthy();
  });
  it("retries only explicitly with byte-identical body/key; a later403 does not erase uncertainty", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("lost ACK")).mockResolvedValueOnce(denial()); vi.stubGlobal("fetch", fetch);
    render(<View />); const dialog = openDraft(); complete(dialog); submitDraft(dialog);
    await waitFor(() => expect(getStaffAnnouncementPending().operation?.phase).toBe("unknown"));
    fireEvent.click(within(dialog).getByRole("button", { name: "重試同一操作" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); await waitFor(() => expect(getStaffAnnouncementPending().operation?.phase).toBe("unknown"));
    const first = fetch.mock.calls[0][1] as RequestInit; const second = fetch.mock.calls[1][1] as RequestInit;
    expect(first.body).toBe(second.body); expect(first.headers).toEqual(second.headers); expect(hasPendingOperations()).toBe(true); expect(refresh).not.toHaveBeenCalled();
  });
  it("a known first-attempt403 releases its lease without claiming success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(denial())); render(<View />); const dialog = openDraft(); complete(dialog); submitDraft(dialog);
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("公告操作未保存"));
    expect(getStaffAnnouncementPending().operation).toBeNull(); expect(hasPendingOperations()).toBe(false); expect(refresh).not.toHaveBeenCalled();
  });
  it("correlated success is saved-but-unconfirmed, not proof the list refreshed", async () => {
    vi.stubGlobal("fetch", successfulFetch()); const source = snapshot(); const view = render(<View source={source} />); const dialog = openDraft(); complete(dialog); submitDraft(dialog);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("操作已保存，但目前清單尚未確認更新。")).toBeTruthy(); expect(getStaffAnnouncementPending().confirmed).toHaveLength(1);
    view.rerender(<View source={{ ...source, items: [], generatedAt: new Date().toISOString() }} row={false} />);
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(1);
    const saved = { ...draft, versionId: uuid(21), announcementKey: uuid(20), title: "合成測試公告" };
    view.rerender(<View source={{ ...source, items: [saved], generatedAt: new Date(Date.now() + 1).toISOString() }} />);
    await waitFor(() => expect(getStaffAnnouncementPending().confirmed).toHaveLength(0));
    expect(screen.queryByText(/清單尚未確認更新/u)).toBeNull(); expect(screen.getByText("公告操作已保存，清單已確認更新。")).toBeTruthy();
  });
  it("returns focus to this owner's recovery region when the committed trigger is disabled without a row section", async () => {
    vi.stubGlobal("fetch", successfulFetch());
    render(<StaffAnnouncementController context={context} snapshot={snapshot()} canPublish hasRecentAal2 canRead>
      <StaffAnnouncementDraftAction staff={staff} roles={[]} canManage demo={false} />
    </StaffAnnouncementController>);
    const trigger = screen.getByRole("button", { name: "建立公告" });
    const dialog = openDraft(); complete(dialog); submitDraft(dialog);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger.hasAttribute("disabled")).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "公告操作回查" }));
  });
  it.each(["malformed", "wrong-chain", "wrong-version"])("keeps %s 2xx uncertain without refresh or a fake success", async (mode) => {
    const fetch = vi.fn(async (_url, init: RequestInit) => {
      const data = receipt("draft", JSON.parse(String(init.body)), draft);
      return mode === "malformed" ? Response.json({}) : response({ ...data, ...(mode === "wrong-chain" ? { announcementKey: uuid(999) } : { version: 9 }) });
    }); vi.stubGlobal("fetch", fetch); render(<View item={draft} />); const dialog = openDraft(); complete(dialog, true); submitDraft(dialog);
    await waitFor(() => expect(getStaffAnnouncementPending().operation?.phase).toBe("unknown")); expect(refresh).not.toHaveBeenCalled(); expect(getStaffAnnouncementPending().confirmed).toHaveLength(0);
  });
  it("hides payload in a foreign branch and ignores late success through scope ABA", async () => {
    let resolve!: (response: Response) => void; let captured!: RequestInit;
    const fetch = vi.fn((_url, init: RequestInit) => { captured = init; return new Promise<Response>((done) => { resolve = done; }); }); vi.stubGlobal("fetch", fetch);
    const source = snapshot(); const view = render(<View source={source} />); const dialog = openDraft(); complete(dialog); submitDraft(dialog);
    expect(fetch).toHaveBeenCalledTimes(1); view.rerender(<View actor={{ ...context, branchId: uuid(999) }} source={null} row={false} />);
    expect(screen.queryByDisplayValue("合成測試公告")).toBeNull(); expect(screen.getByText(/另一個資料範圍/u)).toBeTruthy();
    view.rerender(<View source={source} row={false} />);
    await act(async () => resolve(response(receipt("draft", JSON.parse(String(captured.body))))));
    expect(getStaffAnnouncementPending().operation?.phase).toBe("unknown"); expect(getStaffAnnouncementPending().confirmed).toHaveLength(0); expect(refresh).not.toHaveBeenCalled();
  });
  it("capability ABA invalidates late replies even when canonical actor scope stays unchanged", async () => {
    let resolve!: (response: Response) => void; let captured!: RequestInit;
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => { captured = init; return new Promise<Response>((done) => { resolve = done; }); }));
    const source = snapshot(); const view = render(<View source={source} item={draft} kind="publish" />); fireEvent.click(screen.getByRole("button", { name: "發布公告" })); fireEvent.click(screen.getByRole("button", { name: "確認發布" }));
    view.rerender(<View source={source} item={draft} kind="publish" canPublish={false} />); expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<View source={source} item={draft} kind="publish" />);
    await act(async () => resolve(response(receipt("publish", JSON.parse(String(captured.body)), draft))));
    expect(getStaffAnnouncementPending().operation?.phase).toBe("unknown"); expect(refresh).not.toHaveBeenCalled();
  });
  it("permission loss hides unknown content and prevents retry until authority is restored", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("lost ACK")); vi.stubGlobal("fetch", fetch); const source = snapshot(); const view = render(<View source={source} />);
    const dialog = openDraft(); complete(dialog); submitDraft(dialog); await waitFor(() => expect(getStaffAnnouncementPending().operation?.phase).toBe("unknown"));
    view.rerender(<View actor={{ ...context, scopes: [], assuranceLevel: "aal1" }} source={source} row={false} />);
    expect(screen.queryByDisplayValue("合成測試公告")).toBeNull(); expect(screen.queryByRole("button", { name: "回查上次公告操作" })).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects release settlement when actual recent-AAL2 time expires during the request", async () => {
    let now = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => now); let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    render(<View source={snapshot()} item={draft} kind="publish" />); fireEvent.click(screen.getByRole("button", { name: "發布公告" })); fireEvent.click(screen.getByRole("button", { name: "確認發布" }));
    now += 16 * 60_000; await act(async () => resolve(response(receipt("publish", { draft_version_id: draft.versionId }, draft))));
    expect(getStaffAnnouncementPending().operation?.phase).toBe("unknown"); expect(refresh).not.toHaveBeenCalled();
  });
  it("inline noValidate errors associate with and focus the first invalid field before any POST", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<View />); const dialog = openDraft(); submitDraft(dialog);
    const title = within(dialog).getByRole("textbox", { name: /標題/u });
    expect(title.getAttribute("aria-invalid")).toBe("true"); expect(title.getAttribute("aria-describedby")).toBeTruthy(); expect(document.activeElement).toBe(title);
    expect(dialog.querySelector("form")?.noValidate).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
  it("IME composition blocks submit and native cancel, then preserves edits through discard cancellation", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<View />); const dialog = openDraft(); complete(dialog); const title = within(dialog).getByLabelText("標題 *");
    fireEvent.compositionStart(title); submitDraft(dialog); fireEvent(dialog, new Event("cancel", { cancelable: true, bubbles: false })); expect(dialog.hasAttribute("open")).toBe(true); expect(fetch).not.toHaveBeenCalled();
    fireEvent.compositionEnd(title); fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    const discard = await screen.findByRole("dialog", { name: "放棄未保存的公告編輯？" }); fireEvent.click(within(discard).getByRole("button", { name: "繼續編輯" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "建立公告草稿" })).toBeTruthy()); expect((screen.getByLabelText("標題 *") as HTMLInputElement).value).toBe("合成測試公告");
  });
  it("requires version-change and withdrawal reasons, preserving existing audience and literal body text", async () => {
    const fetch = successfulFetch(draft); vi.stubGlobal("fetch", fetch); render(<View item={draft} />); const dialog = openDraft(); complete(dialog); submitDraft(dialog);
    expect(fetch).not.toHaveBeenCalled(); expect(document.activeElement?.getAttribute("data-announcement-field")).toBe("reason");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /修改理由/u }), { target: { value: "合成更正" } }); submitDraft(dialog);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); const body = JSON.parse(String(fetch.mock.calls[0][1].body)); expect(body.audience_user_ids).toEqual([uuid(4)]); expect(body.change_reason).toBe("合成更正");
  });
  it("source version changes cannot be silently overwritten from the already open editor", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const source = snapshot(); const view = render(<View source={source} item={draft} />); const dialog = openDraft(); complete(dialog, true);
    view.rerender(<View source={{ ...source, items: [{ ...draft, versionId: uuid(77), version: 2 }] }} item={{ ...draft, versionId: uuid(77), version: 2 }} />); submitDraft(dialog);
    expect(screen.getByText(/公告來源或權限已變更/u)).toBeTruthy(); expect(fetch).not.toHaveBeenCalled();
  });
  it("publishes only the captured draft with an exact next version and dates", async () => {
    const fetch = successfulFetch(draft); vi.stubGlobal("fetch", fetch); render(<View item={draft} kind="publish" />);
    fireEvent.click(screen.getByRole("button", { name: "發布公告" })); fireEvent.click(screen.getByRole("button", { name: "確認發布" }));
    await waitFor(() => expect(getStaffAnnouncementPending().confirmed).toHaveLength(1)); expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({ draft_version_id: draft.versionId }); expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("withdraws using current head and active release, never deletes historical data", async () => {
    const fetch = successfulFetch(published); vi.stubGlobal("fetch", fetch); render(<View source={snapshot([published])} item={published} kind="withdraw" />);
    fireEvent.click(screen.getByRole("button", { name: "撤回公告" })); fireEvent.click(screen.getByRole("button", { name: "確認撤回" })); expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: /撤回理由/u }), { target: { value: "合成撤回" } }); fireEvent.click(screen.getByRole("button", { name: "確認撤回" }));
    await waitFor(() => expect(getStaffAnnouncementPending().confirmed).toHaveLength(1)); expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({ expected_latest_version_id: published.versionId, release_version_id: published.activeReleaseVersionId, reason: "合成撤回" });
  });
  it("read binds active release version, not a newer private draft, and accepts only matching receipt", async () => {
    const fetch = successfulFetch(published); vi.stubGlobal("fetch", fetch); render(<View source={snapshot([published])} item={published} kind="read" />);
    fireEvent.click(screen.getByRole("button", { name: "標為已讀" }));
    await waitFor(() => expect(getStaffAnnouncementPending().confirmed).toHaveLength(1)); expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({ release_version_id: published.activeReleaseVersionId });
  });
  it("shared pending lease blocks new announcement operations", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const release = tryAcquirePendingOperation()!;
    render(<View />); expect(screen.getByRole("button", { name: "建立公告" }).hasAttribute("disabled")).toBe(true); expect(fetch).not.toHaveBeenCalled(); release();
  });
  it("scheduled release remains unreadable until published, without a false-enabled action", () => {
    const item = { ...published, lifecycle: "scheduled" as const }; const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<View source={snapshot([item])} item={item} kind="read" />);
    expect(screen.getByRole("button", { name: "標為已讀" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/僅已發布或已到期公告/u)).toBeTruthy(); expect(fetch).not.toHaveBeenCalled();
  });
  it("expired draft cannot open publish, even when the captured generation time was earlier", () => {
    const item = { ...draft, expiresAt: new Date(Date.now() - 10).toISOString() }; const source = { ...snapshot([item]), generatedAt: new Date(Date.now() - 60_000).toISOString() };
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<View source={source} item={item} kind="publish" />);
    expect(screen.getByRole("button", { name: "發布公告" }).hasAttribute("disabled")).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
  it("does not replace saved invalid audience IDs silently; provides explicit removal", async () => {
    const item = { ...draft, audienceUserIds: [uuid(88)] }; const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<View source={snapshot([item])} item={item} />);
    const dialog = openDraft(); complete(dialog, true); submitDraft(dialog); expect(fetch).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("checkbox", { name: /已失效員工/u })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /已失效員工/u })); expect(within(dialog).queryByRole("checkbox", { name: /已失效員工/u })).toBeNull();
  });
  it("actual expiry crossing during an open publish confirmation blocks its first POST", () => {
    let now = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => now); const item = { ...draft, expiresAt: new Date(now + 1000).toISOString() };
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<View source={snapshot([item])} item={item} kind="publish" />); fireEvent.click(screen.getByRole("button", { name: "發布公告" }));
    now += 1500; fireEvent.click(screen.getByRole("button", { name: "確認發布" })); expect(fetch).not.toHaveBeenCalled(); expect(screen.getByText(/公告來源或權限已變更/u)).toBeTruthy();
  });
  it("logout clears recovery payload and releases only the journal's own pending operation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("lost ACK"))); render(<View />); const dialog = openDraft(); complete(dialog); submitDraft(dialog);
    await waitFor(() => expect(getStaffAnnouncementPending().operation?.phase).toBe("unknown")); act(() => clearStaffAnnouncementPendingOnLogout());
    expect(getStaffAnnouncementPending().operation).toBeNull(); expect(hasPendingOperations()).toBe(false); expect(screen.queryByRole("dialog")).toBeNull();
  });
});
