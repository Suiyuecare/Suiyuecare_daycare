// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  StaffAnnouncementAudienceStaff,
  StaffAnnouncementItem,
} from "@/lib/staff-announcements/types";

import {
  StaffAnnouncementDraftAction,
  StaffAnnouncementPublishAction,
  StaffAnnouncementReadAction,
  StaffAnnouncementWithdrawAction,
} from "./staff-announcement-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); refresh.mockClear(); });

const staff: StaffAnnouncementAudienceStaff[] = [{
  userId: "68000000-0000-4000-8000-000000000001",
  displayName: "王社工", employeeCode: "SW-001", profileKind: "staff",
}];
const versionId = "68000000-0000-4000-8000-000000000002";
const announcementKey = "68000000-0000-4000-8000-000000000003";
const releaseId = "68000000-0000-4000-8000-000000000004";
const resultVersionId = "68000000-0000-4000-8000-000000000005";

const draftItem: StaffAnnouncementItem = {
  versionId, announcementKey, version: 1, versionState: "draft",
  title: "員工公告", body: "公告內容", publishAt: "2026-09-02T00:00:00.000Z",
  expiresAt: null, lifecycle: "draft", hasPendingDraft: true,
  audienceUserIds: [staff[0].userId], audienceRoleIds: [], activeReleaseVersionId: null,
  activeReleaseVersion: null, activeReleaseTitle: null, activeReleaseBody: null,
  activeReleasePublishAt: null, activeReleaseExpiresAt: null,
  recipientCount: 0, readCount: 0, unreadCount: 0,
  actorIsRecipient: false, actorReadAt: null, withdrawalReason: null,
};

const publishedItem: StaffAnnouncementItem = {
  ...draftItem, versionId: resultVersionId, version: 3, versionState: "draft",
  title: "未發布新草稿", lifecycle: "published", activeReleaseVersionId: releaseId,
  activeReleaseVersion: 2, activeReleaseTitle: "目前發布公告", activeReleaseBody: "目前內容",
  activeReleasePublishAt: "2026-09-01T00:00:00.000Z", activeReleaseExpiresAt: null,
  recipientCount: 1, unreadCount: 1, actorIsRecipient: true,
};

function response(data: Record<string, unknown>, status = 201) {
  return new Response(JSON.stringify({
    requestId: "68000000-0000-4000-8000-000000000010",
    status: "ok", errors: [], data,
  }), { status, headers: { "Content-Type": "application/json" } });
}

function renderAction(overrides: Partial<Parameters<typeof StaffAnnouncementDraftAction>[0]> = {}) {
  return render(<StaffAnnouncementDraftAction staff={staff} roles={[]} canManage demo={false} {...overrides} />);
}

function complete(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByLabelText("標題 *"), { target: { value: "員工公告" } });
  fireEvent.change(within(dialog).getByLabelText("內容 *"), { target: { value: "公告內容" } });
  fireEvent.change(within(dialog).getByLabelText("發布時間（Asia/Taipei）*"), { target: { value: "2026-09-02T08:00" } });
  fireEvent.change(within(dialog).getByLabelText("到期設定 *"), { target: { value: "none" } });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /王社工/u }));
}

function successResponse(previousVersionId: string | null = null) {
  return response({
      action: "draft", versionId, announcementKey, version: 1,
      previousVersionId, versionState: "draft",
      publishAt: "2026-09-02T00:00:00.000Z", expiresAt: null,
      replayed: false, persisted: true, demo: false,
  });
}

describe("staff announcement draft modal", () => {
  it("keeps demo explicitly read-only", () => {
    renderAction({ demo: true, canManage: false });
    expect(screen.getByRole("button", { name: "建立公告" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "建立公告" }).getAttribute("title")).toContain("展示模式");
  });

  it("closes after correlated success and restores focus to the trigger", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successResponse()));
    renderAction();
    const trigger = screen.getByRole("button", { name: "建立公告" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "建立公告草稿" });
    complete(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "建立不可變草稿" }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole("status").textContent).toContain("68000000");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("locks every dismissal path while the request is pending", async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>((done) => { resolve = done; })));
    renderAction();
    fireEvent.click(screen.getByRole("button", { name: "建立公告" }));
    const dialog = screen.getByRole("dialog", { name: "建立公告草稿" });
    complete(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "建立不可變草稿" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "取消" }).hasAttribute("disabled")).toBe(true));
    expect(within(dialog).getByRole("button", { name: "關閉" }).hasAttribute("disabled")).toBe(true);
    expect(within(dialog).getByLabelText("標題 *").closest("fieldset")?.hasAttribute("disabled")).toBe(true);
    fireEvent.click(dialog);
    expect(dialog.hasAttribute("open")).toBe(true);
    resolve(successResponse());
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
  });

  it("keeps the modal open and exposes request ID on malicious 2xx correlation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successResponse(versionId)));
    renderAction();
    fireEvent.click(screen.getByRole("button", { name: "建立公告" }));
    const dialog = screen.getByRole("dialog", { name: "建立公告草稿" });
    complete(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "建立不可變草稿" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("68000000"));
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("staff announcement publish action", () => {
  function renderPublish(overrides: Partial<Parameters<typeof StaffAnnouncementPublishAction>[0]> = {}) {
    return render(<StaffAnnouncementPublishAction item={draftItem} canPublish hasRecentAal2
      demo={false} generatedAt="2026-09-01T00:00:00.000Z" {...overrides} />);
  }

  it("exposes permission and recent-AAL2 disabled reasons", () => {
    const first = renderPublish({ canPublish: false });
    expect(screen.getByRole("button", { name: "發布公告" }).getAttribute("title"))
      .toContain("announcements.publish");
    first.unmount();
    renderPublish({ hasRecentAal2: false });
    expect(screen.getByRole("button", { name: "發布公告" }).getAttribute("title"))
      .toContain("15 分鐘 AAL2");
  });

  it("locks dismiss and duplicate submission, then accepts one correlated receipt", async () => {
    let resolve!: (value: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();
    const trigger = screen.getByRole("button", { name: "發布公告" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "發布公告" });
    const submit = within(dialog).getByRole("button", { name: "發布公告" });
    fireEvent.click(submit);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "取消" }).hasAttribute("disabled")).toBe(true));
    fireEvent.click(submit);
    fireEvent.click(dialog);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dialog.hasAttribute("open")).toBe(true);
    resolve(response({
      action: "publish", versionId: resultVersionId, announcementKey, version: 2,
      draftVersionId: versionId, lifecycle: "published", publishAt: draftItem.publishAt,
      expiresAt: null, recipientCount: 1, replayed: false, persisted: true, demo: false,
    }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole("status").textContent).toContain("68000000");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open on a mismatched 2xx target receipt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      action: "publish", versionId: resultVersionId, announcementKey, version: 2,
      draftVersionId: releaseId, lifecycle: "published", publishAt: draftItem.publishAt,
      expiresAt: null, recipientCount: 1, replayed: true, persisted: true, demo: false,
    }, 200)));
    renderPublish();
    fireEvent.click(screen.getByRole("button", { name: "發布公告" }));
    const dialog = screen.getByRole("dialog", { name: "發布公告" });
    fireEvent.click(within(dialog).getByRole("button", { name: "發布公告" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("68000000"));
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("staff announcement withdrawal action", () => {
  function renderWithdraw(overrides: Partial<Parameters<typeof StaffAnnouncementWithdrawAction>[0]> = {}) {
    return render(<StaffAnnouncementWithdrawAction item={publishedItem} canPublish hasRecentAal2
      demo={false} generatedAt="2026-09-01T00:00:00.000Z" {...overrides} />);
  }

  it("freezes pending inputs and closes only for an exact withdrawal receipt", async () => {
    let resolve!: (value: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    renderWithdraw();
    const trigger = screen.getByRole("button", { name: "撤回公告" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "撤回公告" });
    fireEvent.change(within(dialog).getByLabelText("撤回理由 *"), { target: { value: "內容已改版" } });
    const submit = within(dialog).getByRole("button", { name: "撤回公告" });
    fireEvent.click(submit);
    await waitFor(() => expect(within(dialog).getByLabelText("撤回理由 *").hasAttribute("disabled")).toBe(true));
    fireEvent.click(submit);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(response({
      action: "withdraw", versionId: versionId, announcementKey, version: 4,
      previousVersionId: publishedItem.versionId, lifecycle: "withdrawn",
      releaseVersionId: releaseId, reason: "內容已改版", withdrawnAt: "2026-09-01T01:00:00.000Z",
      replayed: false, persisted: true, demo: false,
    }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(document.activeElement).toBe(trigger);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog and idempotency context on a mismatched 2xx lineage receipt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      action: "withdraw", versionId, announcementKey, version: 4,
      previousVersionId: releaseId, lifecycle: "withdrawn", releaseVersionId: releaseId,
      reason: "內容已改版", withdrawnAt: "2026-09-01T01:00:00.000Z",
      replayed: true, persisted: true, demo: false,
    }, 200)));
    renderWithdraw();
    fireEvent.click(screen.getByRole("button", { name: "撤回公告" }));
    const dialog = screen.getByRole("dialog", { name: "撤回公告" });
    fireEvent.change(within(dialog).getByLabelText("撤回理由 *"), { target: { value: "內容已改版" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "撤回公告" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("68000000"));
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("staff announcement read action", () => {
  it("shows an honest permission disabled reason", () => {
    render(<StaffAnnouncementReadAction item={{ ...publishedItem, versionState: "release", versionId: releaseId }}
      enabled={false} demo={false} />);
    expect(screen.getByRole("button", { name: "標為已讀" }).getAttribute("title"))
      .toContain("announcements.read");
  });

  it("locks duplicate clicks and accepts only the correlated release receipt", async () => {
    let resolve!: (value: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffAnnouncementReadAction item={{ ...publishedItem, versionState: "release", versionId: releaseId }}
      enabled demo={false} />);
    const button = screen.getByRole("button", { name: "標為已讀" });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(response({
      action: "read", releaseVersionId: releaseId, announcementKey,
      readAt: "2026-09-01T01:00:00.000Z", replayed: false, persisted: true, demo: false,
    }));
    await waitFor(() => expect(screen.getByText(/68000000/u)).toBeTruthy());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh on a malicious 2xx release mismatch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      action: "read", releaseVersionId: versionId, announcementKey,
      readAt: "2026-09-01T01:00:00.000Z", replayed: true, persisted: true, demo: false,
    }, 200)));
    render(<StaffAnnouncementReadAction item={{ ...publishedItem, versionState: "release", versionId: releaseId }}
      enabled demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "標為已讀" }));
    await waitFor(() => expect(screen.getByText(/68000000/u)).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });
});
