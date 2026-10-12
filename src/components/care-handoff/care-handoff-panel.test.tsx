// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getScopeChangePendingReason } from "@/lib/navigation/scope-change-pending";
import { CareHandoffPanel } from "./care-handoff-panel";
const clientId = "84000000-0000-4000-8000-000000000001", sourceRecordId = "84000000-0000-4000-8000-000000000002", actorId = "84000000-0000-4000-8000-000000000003", receiver = "84000000-0000-4000-8000-000000000004";
const snapshot = { clientId, actorId, recipients: [{ id: receiver, name: "合成接班人" }], rows: [] };
function response(data: unknown) { return Promise.resolve(new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" } })); }
function open() { const details = screen.getByText("交班與追蹤").closest("details")!; details.open = true; fireEvent(details, new Event("toggle")); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); expect(getScopeChangePendingReason()).toBeNull(); });
describe("care handoff safety", () => {
  it("does not crash or send when a deadline is missing or invalid", async () => {
    const fetcher = vi.fn().mockImplementation(() => response({ snapshot })); vi.stubGlobal("fetch", fetcher);
    render(<CareHandoffPanel clientId={clientId} sourceRecordId={sourceRecordId} canWrite />); open(); fireEvent.click(await screen.findByRole("button", { name: "送出交班" }));
    expect(screen.getByText("請選接班人，並填寫交班內容與期限。")).toBeTruthy(); expect(fetcher.mock.calls.every(call => call[1]?.method !== "POST")).toBe(true);
  });
  it("retains the same operation after a timeout and protects drafts until receipt is confirmed", async () => {
    const posts: string[] = []; let count = 0; vi.stubGlobal("fetch", vi.fn((_url: string, options?: RequestInit) => { if (options?.method === "POST") { posts.push(String(options.body)); if (++count === 1) return Promise.reject(new Error("network")); return response({ receipt: { id: sourceRecordId, version: 1, replayed: true } }); } return response({ snapshot }); }));
    render(<CareHandoffPanel clientId={clientId} sourceRecordId={sourceRecordId} canWrite />); open(); fireEvent.change(await screen.findByLabelText("接班人"), { target: { value: receiver } }); fireEvent.change(screen.getByLabelText("追蹤期限（台北時間）"), { target: { value: "2026-10-12T10:00" } }); fireEvent.change(screen.getByLabelText("交班內容"), { target: { value: "合成追蹤事項" } });
    expect(getScopeChangePendingReason()).toBe("dirty"); fireEvent.click(screen.getByRole("button", { name: "送出交班" })); await screen.findByText(/結果尚未確認/); expect(getScopeChangePendingReason()).toBe("unknown");
    fireEvent.click(screen.getByRole("button", { name: "重試原操作" })); await screen.findByText("交班已保存"); expect(posts).toHaveLength(2); expect(posts[0]).toBe(posts[1]); expect(JSON.parse(posts[0]).dueAt).toBe("2026-10-12T02:00:00.000Z"); expect((screen.getByLabelText("交班內容") as HTMLTextAreaElement).value).toBe("");
  });
});
