// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const mock = vi.hoisted(() => ({ requireContext: vi.fn(), canRead: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ requireTenantContext: mock.requireContext }));
vi.mock("@/lib/staff-qualification-readiness/server", () => ({ canReadQualificationReport: mock.canRead, loadQualificationReport: mock.load }));
vi.mock("@/components/staff-qualification-readiness/qualification-workspace", () => ({ QualificationWorkspace: () => <p>已載入授權報表</p> }));
import QualificationPage from "./page";
afterEach(cleanup);
describe("qualification page access and invalid-filter UI", () => {
  beforeEach(() => { vi.clearAllMocks(); mock.requireContext.mockResolvedValue({ branchId: "trusted-scope" }); mock.canRead.mockReturnValue(true); mock.load.mockResolvedValue({}); });
  it("keeps anonymous redirect from the existing tenant guard", async () => {
    mock.requireContext.mockRejectedValue(new Error("LOGIN_REDIRECT"));
    await expect(QualificationPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("LOGIN_REDIRECT");
    expect(mock.load).not.toHaveBeenCalled();
  });
  it("renders permission help without reading staff records", async () => {
    mock.canRead.mockReturnValue(false); render(await QualificationPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert").textContent).toContain("無法查看員工證照清單");
    expect(mock.load).not.toHaveBeenCalled();
  });
  it("rejects unrecognized branch filters without reading staff records", async () => {
    render(await QualificationPage({ searchParams: Promise.resolve({ branch: "foreign" }) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("請檢查篩選條件");
    expect(mock.load).not.toHaveBeenCalled();
  });
  it("passes strictly parsed filters with the server principal, not query scope", async () => {
    render(await QualificationPage({ searchParams: Promise.resolve({ issue: "due_soon", q: "  測試  " }) }));
    expect(mock.load).toHaveBeenCalledExactlyOnceWith({ branchId: "trusted-scope" }, { issue: "due_soon", staff: null, query: "測試" });
    expect(screen.getByText("已載入授權報表")).toBeTruthy();
  });
});
