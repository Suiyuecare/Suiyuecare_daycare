// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getScopeChangePendingReason } from "@/lib/navigation/scope-change-pending";
import { ClinicalAttachments } from "./clinical-attachments";
const source = { clientId: "84000000-0000-4000-8000-000000000001", sourceKind: "care_diary" as const, sourceId: "84000000-0000-4000-8000-000000000002", sourceVersion: 1 };
const attachmentId = "84000000-0000-4000-8000-000000000003";
function response(data: unknown) { return Promise.resolve(new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" } })); }
function open() { const summary = screen.getByText("照片與附件"); const details = summary.closest("details")!; details.open = true; fireEvent(details, new Event("toggle")); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); expect(getScopeChangePendingReason()).toBeNull(); });
describe("clinical attachment UI", () => {
  it("never presents an upload or download when scanning is not configured", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => response({ snapshot: { ...source, canUpload: true, rows: [] }, uploadConfigured: false })));
    render(<ClinicalAttachments source={source} canManage />); open(); await screen.findByText(/附件安全檢查尚未啟用/); expect(screen.queryByRole("button", { name: "上傳" })).toBeNull(); expect(screen.queryByRole("button", { name: "查看" })).toBeNull();
  });
  it("can recover a pending attachment without scanner fabrication or duplicate cancellation", async () => {
    let posted = 0; const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, options?: RequestInit) => { if (options?.method === "POST") { calls.push(String(options.body)); if (++posted === 1) return Promise.reject(new Error("network")); return response({ receipt: { id: attachmentId, cancelled: true } }); } return response({ snapshot: { ...source, canUpload: true, rows: [{ id: attachmentId, label: "待完成照片", mimeType: "image/png", fileSizeBytes: 64, scanStatus: posted > 1 ? "failed" : "reserved", createdAt: "2026-10-11T01:00:00Z", canDownload: false }] }, uploadConfigured: false }); }));
    render(<ClinicalAttachments source={source} canManage />); open(); fireEvent.click(await screen.findByRole("button", { name: "標記上傳未完成" })); await screen.findByText(/中止結果尚未確認/); expect(getScopeChangePendingReason()).toBe("unknown");
    fireEvent.click(screen.getByRole("button", { name: "重試中止上傳" })); await screen.findByText(/此附件已標記未完成/); expect(calls).toHaveLength(2); expect(calls[0]).toBe(calls[1]); expect(screen.queryByRole("button", { name: "查看" })).toBeNull();
  });
  it("rejects a snapshot that belongs to another source instead of displaying it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => response({ snapshot: { ...source, sourceId: attachmentId, canUpload: true, rows: [] }, uploadConfigured: true })));
    render(<ClinicalAttachments source={source} canManage />); open(); await screen.findByRole("alert"); expect(screen.queryByLabelText("附件名稱")).toBeNull();
  });
  it("hides previously authorized attachments when a download detects revoked access", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, options?: RequestInit) => options?.method === "POST"
      ? Promise.resolve(new Response(JSON.stringify({ error: { code: "FORBIDDEN" } }), { status: 403 }))
      : response({ snapshot: { ...source, canUpload: false, rows: [{ id: attachmentId, label: "授權撤回後不可保留的照片", mimeType: "image/png", fileSizeBytes: 64, scanStatus: "clean", createdAt: "2026-10-11T01:00:00Z", canDownload: true }] }, uploadConfigured: false })));
    render(<ClinicalAttachments source={source} canManage />); open();
    fireEvent.click(await screen.findByRole("button", { name: "查看" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("授權撤回後不可保留的照片")).toBeNull();
    expect(screen.queryByRole("button", { name: "查看" })).toBeNull();
  });
});
