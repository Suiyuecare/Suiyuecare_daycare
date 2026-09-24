// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useRef } from "react";
import type { TenantContext } from "@/lib/domain/types";
import { OfflineCareProvider } from "./offline-care-provider";
import { OfflineCareFormNotice, useOfflineCareForm } from "./offline-care-form";

const mocks = vi.hoisted(() => ({ records: new Map<string, Map<string, unknown>>(), save: vi.fn(), remove: vi.fn(), load: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => { const router = { refresh: mocks.refresh }; return { useRouter: () => router }; });
vi.mock("@/lib/offline/draft-store", () => ({ getOfflineStorageGeneration: () => "test-generation", saveOfflineDraft: mocks.save, removeOfflineDraft: mocks.remove, loadOfflineDrafts: mocks.load }));
const clientId = "11111111-1111-4111-8111-111111111111";
const operationId = "22222222-2222-4222-8222-222222222222";
const context: TenantContext = { organizationId: "33333333-3333-4333-8333-333333333333", branchId: "44444444-4444-4444-8444-444444444444",
  userId: "55555555-5555-4555-8555-555555555555", organizationName: "合成", branchName: "合成分支", displayName: "合成人員",
  roles: ["care_worker"], scopes: ["care_records.write"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
function scopeKey(scope: { organizationId: string; branchId: string; userId: string }) { return `${scope.organizationId}:${scope.branchId}:${scope.userId}`; }
function Form({ demo = false }: { demo?: boolean }) {
  const formRef = useRef<HTMLFormElement>(null); const idempotencyKey = useRef(operationId);
  const offline = useOfflineCareForm({ kind: "care-note", serviceDate: "2026-09-12", enabled: true, demo,
    allowedClientIds: [clientId], formRef, idempotencyKey, onRestoreId: (id) => { idempotencyKey.current = id; } });
  return <form ref={formRef} onChange={() => { void offline.capture(); }} onSubmit={(event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void offline.queueIfOffline({ client_id: clientId, page_slug: "staff/daily-care/care-diary", occurred_at: "2026-09-12T01:00:00.000Z",
      data: { shift: "morning", care_item: "活動", note: data.get("note"), abnormal: false } });
  }}>
    <label>個案<select name="client_id" defaultValue={clientId}><option value={clientId}>合成個案</option></select></label>
    <label>紀錄<input name="note" /></label>
    <button type="submit">儲存草稿</button>
    <OfflineCareFormNotice offline={offline} />
  </form>;
}
function View({ actor = context }: { actor?: TenantContext }) { return <OfflineCareProvider context={actor}><Form demo={actor.demo} /></OfflineCareProvider>; }
beforeEach(() => {
  vi.clearAllMocks(); mocks.records.clear(); vi.stubGlobal("crypto", webcrypto);
  mocks.load.mockImplementation(async (scope) => [...(mocks.records.get(scopeKey(scope))?.values() ?? [])]);
  mocks.save.mockImplementation(async (scope, item) => {
    const items = mocks.records.get(scopeKey(scope)) ?? new Map();
    items.set(item.id, { ...item, createdAt: item.createdAt ?? new Date().toISOString(), expiresAt: item.expiresAt ?? new Date(Date.now() + 86_400_000).toISOString() });
    mocks.records.set(scopeKey(scope), items);
  });
  mocks.remove.mockImplementation(async (scope, id) => { mocks.records.get(scopeKey(scope))?.delete(id); });
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("care form local drafts", () => {
  it("auto-saves scoped local drafts and recovers exact original contents and key", async () => {
    const view = render(<View />);
    fireEvent.change(screen.getByLabelText("紀錄"), { target: { value: "合成觀察待確認" } });
    await screen.findByText("已暫存這台裝置，尚未送出。最多保留 24 小時。");
    expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ userId: context.userId, branchId: context.branchId }),
      expect.objectContaining({ id: operationId, baseVersion: 0, payload: expect.objectContaining({ state: "local" }) }), "test-generation");
    view.unmount(); render(<View />);
    fireEvent.click(await screen.findByRole("button", { name: /恢復.*未送出草稿/u }));
    expect(screen.getByLabelText("紀錄")).toHaveValue("合成觀察待確認");
    expect(screen.getByText(/已恢復原草稿/u)).toBeInTheDocument();
  });
  it("does not show another account's local draft", async () => {
    const view = render(<View />); fireEvent.change(screen.getByLabelText("紀錄"), { target: { value: "合成機密" } });
    await screen.findByText(/已暫存這台裝置/u); view.unmount();
    render(<View actor={{ ...context, userId: "66666666-6666-4666-8666-666666666666" }} />);
    await waitFor(() => expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({ userId: "66666666-6666-4666-8666-666666666666" }), "test-generation"));
    expect(screen.queryByRole("button", { name: /恢復/u })).not.toBeInTheDocument(); expect(screen.getByLabelText("紀錄")).toHaveValue("");
  });
  it("retains storage failures without claiming a local save", async () => {
    mocks.save.mockRejectedValue(new Error("quota detail")); render(<View />);
    fireEvent.change(screen.getByLabelText("紀錄"), { target: { value: "未存" } });
    expect(await screen.findByText(/装置草稿尚未確認保存|裝置草稿尚未確認保存/u)).toBeInTheDocument();
    expect(screen.queryByText(/已暫存這台裝置/u)).not.toBeInTheDocument();
  });
  it("only syncs an explicit submission after reconnection, with pinned actor scope", async () => {
    const send = vi.fn().mockResolvedValue(Response.json({ requestId: "verified", status: "ok", errors: [], data: {
      demo: false, persisted: true, replayed: false, record: { id: "new-record", version: 1, status: "draft" }, page: { slug: "staff/daily-care/care-diary" },
    } }, { status: 201 })); vi.stubGlobal("fetch", send);
    render(<View />); fireEvent.change(screen.getByLabelText("紀錄"), { target: { value: "離線合成紀錄" } });
    await screen.findByText(/已暫存這台裝置/u); expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));
    await screen.findByText(/已保存在裝置等待送出/u); expect(send).not.toHaveBeenCalled();
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(expect.anything(), operationId, undefined, "test-generation"));
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][1].headers).toMatchObject({ "Idempotency-Key": operationId,
      "X-Care-User": context.userId, "X-Care-Branch": context.branchId, "X-Care-Organization": context.organizationId });
    expect(await screen.findByText("日誌草稿已儲存，仍待提交與簽署。")).toBeInTheDocument();
  });
  it("never stores synthetic demo records on the device", async () => {
    render(<View actor={{ ...context, demo: true }} />);
    fireEvent.change(screen.getByLabelText("紀錄"), { target: { value: "合成" } });
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.load).not.toHaveBeenCalled();
  });
  it("stops reading and syncing after logout clear", async () => {
    render(<View />); fireEvent.change(screen.getByLabelText("紀錄"), { target: { value: "合成" } });
    await screen.findByText(/已暫存這台裝置/u);
    await act(async () => { window.dispatchEvent(new Event("daycare-offline-cleared")); });
    expect(screen.queryByRole("button", { name: /恢復/u })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "此工作階段已結束" })).toBeInTheDocument();
    expect(screen.queryByLabelText("紀錄")).not.toBeInTheDocument();
    const count = mocks.load.mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(mocks.load).toHaveBeenCalledTimes(count);
  });
});
