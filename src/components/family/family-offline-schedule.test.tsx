// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FamilyMessageDraft } from "@/lib/offline/family-outbox";
const store = vi.hoisted(() => ({ rows: [] as unknown[], load: vi.fn(), save: vi.fn(), remove: vi.fn(), generation: "generation" }));
vi.mock("@/lib/offline/draft-store", () => ({ getOfflineStorageGeneration: () => store.generation, loadOfflineDrafts: (...args: unknown[]) => store.load(...args), saveOfflineDraft: (...args: unknown[]) => store.save(...args), removeOfflineDraft: (...args: unknown[]) => store.remove(...args) }));
vi.mock("@/lib/offline/outbox-lock", () => ({ withOfflineOutboxLock: (fn: () => Promise<void>) => fn() }));
import { FamilyMessageComposer } from "./family-message-composer";
import { FamilySchedule } from "./family-schedule";
import { queueFamilyMessage } from "@/lib/offline/family-outbox";
const clientId = "e9300000-0000-4000-8000-000000000001", other = "e9300000-0000-4000-8000-000000000002";
const namespace = { organizationId: "e9100000-0000-4000-8000-000000000001", branchId: "e9200000-0000-4000-8000-000000000001", userId: "e9000000-0000-4000-8000-000000000002" };
const draft: FamilyMessageDraft = { id: "e9700000-0000-4000-8000-000000000001", kind: "family-message", clientRef: clientId, baseVersion: 3, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+86_400_000).toISOString(), payload: { schema: 1, body: "合成持久草稿", state: "local" } };
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); store.rows = []; store.load.mockReset().mockImplementation(async () => store.rows); store.save.mockReset().mockImplementation(async (_scope, row) => { store.rows = [row]; }); store.remove.mockReset().mockImplementation(async (_scope, id) => { store.rows = store.rows.filter(row => (row as FamilyMessageDraft).id !== id); return true; }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("family draft and monthly UX", () => {
  it("restores only this client and retains original baseline after reload", async () => {
    store.rows = [draft, { ...draft, id: other, clientRef: other, payload: { ...draft.payload, body: "不可見其他案" } }];
    render(<FamilyMessageComposer clientId={clientId} version={8} namespace={namespace} onSaved={vi.fn()} onRevoked={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "接續填寫" })); expect((screen.getByLabelText("給機構的訊息") as HTMLTextAreaElement).value).toBe(draft.payload.body); expect(screen.queryByText("不可見其他案")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" })); await waitFor(() => expect(store.save).toHaveBeenCalled()); expect(store.save.mock.calls[0][1]).toMatchObject({ id: draft.id, baseVersion: 3, createdAt: draft.createdAt, expiresAt: draft.expiresAt });
  });
  it("saved local text survives component remount and logout signal clears displayed drafts", async () => {
    const props = { clientId, version: 0, namespace, onSaved: vi.fn(), onRevoked: vi.fn() }; const view = render(<FamilyMessageComposer {...props} />);
    await waitFor(() => expect(store.load).toHaveBeenCalled()); fireEvent.change(screen.getByLabelText("給機構的訊息"), { target: { value: "保存這一份" } }); fireEvent.click(screen.getByRole("button", { name: "保存草稿" })); await screen.findByText("保存這一份"); view.unmount(); render(<FamilyMessageComposer {...props} />); await screen.findByText("保存這一份");
    window.dispatchEvent(new CustomEvent("daycare-offline-cleared")); await waitFor(() => expect(screen.queryByText("保存這一份")).toBeNull());
  });
  it("without device storage scope retains exact online attempt for retry", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("lost")).mockResolvedValue(Response.json({ data: { receipt: { id: draft.id, replayed: true, status: "saved" } } })); vi.stubGlobal("fetch", fetcher);
    render(<FamilyMessageComposer clientId={clientId} version={7} onSaved={vi.fn()} onRevoked={vi.fn()} />); fireEvent.change(screen.getByLabelText("給機構的訊息"), { target: { value: "不可重複的訊息" } }); fireEvent.click(screen.getByRole("button", { name: "送出" })); fireEvent.click(await screen.findByRole("button", { name: "重試原操作" })); await screen.findByText("訊息已送出"); expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  });
  it("starts the queued original command immediately when connection returns", async () => {
    const online = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const queued = await queueFamilyMessage(draft); store.rows = [queued];
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { receipt: { id: draft.id, replayed: true, status: "saved" } } })); vi.stubGlobal("fetch", fetcher);
    const onSaved = vi.fn(); render(<FamilyMessageComposer clientId={clientId} version={9} namespace={namespace} onSaved={onSaved} onRevoked={vi.fn()} />);
    await screen.findByText(draft.payload.body); expect(fetcher).not.toHaveBeenCalled();
    online.mockReturnValue(true); fireEvent(window, new Event("online"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const options = fetcher.mock.calls[0][1];
    expect(JSON.parse(options.body)).toMatchObject({ expectedVersion: 3, idempotency_key: draft.id, clientId });
    expect(options.headers).toMatchObject({ "x-care-organization": namespace.organizationId, "x-care-branch": namespace.branchId, "x-care-user": namespace.userId });
    expect(store.remove).toHaveBeenCalledWith(namespace, draft.id, undefined, "generation");
  });
  it("calendar and list reflect the same source items and cancellation state", async () => {
    vi.stubGlobal("fetch", vi.fn(async url => { const month = new URL(String(url),"https://local.invalid").searchParams.get("month")!; return Response.json({ data: { snapshot: { clientId, month, items: [{ id: draft.id, kind: "transport", version: 1, date: `${month}-11`, startsAt: `${month}-11T09:00:00+08:00`, endsAt: `${month}-11T10:00:00+08:00`, direction: "pickup", title: "合成到站接送", status: "cancelled", sourceHash: "a".repeat(64) }], snapshotHash: "b".repeat(64), updatedAt: "2026-10-12T00:00:00Z" } } }); }));
    render(<FamilySchedule clientId={clientId} />); await screen.findByText("合成到站接送"); expect(screen.getByText("已取消")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "月曆" })); expect(screen.getByText("合成到站接送")).toBeTruthy(); expect(screen.getByText(/09:00:00 · 已取消/)).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "列表" })); expect(screen.getByText("已取消")).toBeTruthy();
  });
  it("never displays a calendar from another client or preserves it after revoked consent", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { snapshot: { clientId: other, month: "2026-10", items: [], snapshotHash: "a".repeat(64), updatedAt: "2026-10-12T00:00:00Z" } } })); vi.stubGlobal("fetch", fetcher); render(<FamilySchedule clientId={clientId} />); await screen.findByRole("alert"); expect(screen.queryByText("本月尚無已核准的活動或接送")).toBeNull();
    fetcher.mockResolvedValue(Response.json({}, { status: 403 })); fireEvent.click(screen.getByRole("button", { name: "更新行程" })); await screen.findByText("此個案的行程授權已失效。");
  });
});
