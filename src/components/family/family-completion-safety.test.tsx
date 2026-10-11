// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getScopeChangePendingReason } from "@/lib/navigation/scope-change-pending";
import type { FamilyWorkspaceSnapshot } from "@/lib/family/workspace-schema";
import { FamilyPublicationPanel } from "./family-publication-panel";
import { FamilyLiveWorkspace } from "./family-live-workspace";
import { StaffFamilyCommunication } from "./staff-family-communication";
const clientId = "84000000-0000-4000-8000-000000000001";
const sourceId = "84000000-0000-4000-8000-000000000002";
const recipientId = "84000000-0000-4000-8000-000000000003";
const stamp = "2026-10-11T01:00:00Z";
const snapshot: FamilyWorkspaceSnapshot = { clientId, messageVersion: 1, scopes: ["messages.read"], publications: [], messages: [{ id: sourceId, body: "只屬於授權個案的訊息", direction: "institution_to_family", at: stamp, read: false }], preferences: { version: 0, pushEnabled: true, categories: ["messages"], quietStart: "21:00", quietEnd: "07:00", contactPhone: null }, unreadCount: 1, updatedAt: stamp };
function response(data: unknown, status = 200) { return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } })); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); expect(getScopeChangePendingReason()).toBeNull(); });

describe("family completion safety", () => {
  it("keeps a frozen publication and idempotency key after an uncertain response", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("network")).mockImplementationOnce(() => response({ data: { receipt: { id: sourceId, replayed: true } } })); vi.stubGlobal("fetch", fetcher);
    render(<FamilyPublicationPanel clientId={clientId} sourceId={sourceId} category="care" occurredAt={stamp} enabled />);
    fireEvent.click(screen.getByText("發布家屬摘要"));
    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "今日摘要" } }); fireEvent.change(screen.getByLabelText("給家屬的摘要"), { target: { value: "今日參與活動" } });
    expect(getScopeChangePendingReason()).toBe("dirty"); fireEvent.click(screen.getByRole("button", { name: "核對並發布" }));
    await screen.findByText(/發布尚未確認/); expect(getScopeChangePendingReason()).toBe("unknown");
    expect((screen.getByLabelText("標題") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "重試原操作" })); await screen.findByText("已發布給有此資料類別授權的家屬");
    expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body); expect(getScopeChangePendingReason()).toBeNull();
    expect((screen.getByLabelText("標題") as HTMLInputElement).value).toBe("");
  });
  it("unmounts a publication draft when its source/client changes", () => {
    const view = render(<FamilyPublicationPanel clientId={clientId} sourceId={sourceId} category="care" occurredAt={stamp} enabled />); fireEvent.click(screen.getByText("發布家屬摘要")); fireEvent.change(screen.getByLabelText("標題"), { target: { value: "不可帶到另一個案" } });
    expect(getScopeChangePendingReason()).toBe("dirty"); view.rerender(<FamilyPublicationPanel clientId={recipientId} sourceId={sourceId} category="care" occurredAt={stamp} enabled />);
    expect(getScopeChangePendingReason()).toBeNull(); fireEvent.click(screen.getByText("發布家屬摘要")); expect((screen.getByLabelText("標題") as HTMLInputElement).value).toBe("");
  });
  it("hides authorized data immediately when the refresh receives revoked consent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => response({ error: { code: "FORBIDDEN" } }, 403)));
    render(<FamilyLiveWorkspace initial={snapshot} pageNumber={85} title="家屬溝通" />); expect(screen.getByText(snapshot.messages[0].body)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "更新" })); await screen.findByRole("alert"); expect(screen.queryByText(snapshot.messages[0].body)).toBeNull();
  });
  it("protects unsent family preferences and requires explicit discard before refreshing", () => {
    render(<FamilyLiveWorkspace initial={snapshot} pageNumber={89} title="通知與設定" />);
    fireEvent.change(screen.getByLabelText("聯絡手機"), { target: { value: "0912345678" } }); expect(getScopeChangePendingReason()).toBe("dirty"); expect((screen.getByRole("button", { name: "更新" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "清除未送出內容" })); expect(getScopeChangePendingReason()).toBeNull(); expect((screen.getByLabelText("聯絡手機") as HTMLInputElement).value).toBe("");
  });
  it("loads only an explicitly selected family and blocks scope switching while its reply is unresolved", async () => {
    const fetcher = vi.fn((url: string, options?: RequestInit) => options?.method === "POST" ? Promise.reject(new Error("network")) : response({ data: { snapshot: { clientId, recipientId: new URL(url, "https://test.invalid").searchParams.get("recipient"), recipients: [{ id: recipientId, name: "授權家屬甲" }], messages: [], publications: [], sources: [], canPublish: false, updatedAt: stamp } } })); vi.stubGlobal("fetch", fetcher);
    render(<StaffFamilyCommunication clients={[{ id: clientId, name: "合成個案", code: "X1" }]} initialClientId={clientId} />);
    const select = await screen.findByLabelText("家屬"); expect(screen.queryByLabelText("給家屬的訊息")).toBeNull();
    fireEvent.change(select, { target: { value: recipientId } }); const input = await screen.findByLabelText("給家屬的訊息"); fireEvent.change(input, { target: { value: "只給指定家屬" } }); fireEvent.click(screen.getByRole("button", { name: "送出" })); await screen.findByText(/結果尚未確認/);
    expect((screen.getByLabelText("個案") as HTMLSelectElement).disabled).toBe(true); expect((screen.getByLabelText("家屬") as HTMLSelectElement).disabled).toBe(true); expect(getScopeChangePendingReason()).toBe("unknown");
    const post = fetcher.mock.calls.find(call => call[1]?.method === "POST"); expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ clientId, recipientUserId: recipientId, body: "只給指定家屬" });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  });
});
