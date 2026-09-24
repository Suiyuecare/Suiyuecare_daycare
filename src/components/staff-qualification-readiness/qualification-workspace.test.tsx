// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { buildDemoStaffCertificateSnapshot } from "@/lib/staff-certificates/demo";
import { projectQualificationReport } from "@/lib/staff-qualification-readiness/projection";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { QualificationWorkspace } from "./qualification-workspace";
const scope = { organizationId: "72000000-0000-4000-8000-000000000001", branchId: "72000000-0000-4000-8000-000000000002", branchName: "合成分支" };
function report() { return projectQualificationReport(buildDemoStaffCertificateSnapshot({ ...scope, filters: { staffMembershipId: null, certificateType: null, status: "all", query: "" }, now: new Date("2026-09-14T03:00:00Z") }), scope, { staff: null, issue: "all", query: "" }); }
afterEach(cleanup);
describe("qualification report staff-facing UI", () => {
  it("shows actionable dates with policy boundary, accessible controls and scoped source links", () => {
    render(<QualificationWorkspace report={report()} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("員工證照到期與補件");
    expect(screen.getByText("這是補件與到期提醒，不是可執行服務的資格核准。")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "員工" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "搜尋員工或證照" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "查看展示員工甲的證照" }).getAttribute("href")).toContain("staff=72040000");
    expect(screen.queryByText(/SYNTH-/)).toBeNull();
  });
  it("does not display a false missing-record zero for truncated source", () => {
    const value = report(); value.incomplete = true; value.missingRecordsKnown = false;
    render(<QualificationWorkspace report={value} />);
    expect(screen.getByRole("alert").textContent).toContain("不是分支完整總數");
    expect(screen.getByRole("link", { name: /未建有效證照紀錄：待確認/ })).toBeTruthy();
  });
  it("does not treat empty filtered rows as approved service eligibility", () => {
    const value = report(); value.rows = []; render(<QualificationWorkspace report={value} />);
    expect(screen.getByText("此篩選下沒有紀錄")).toBeTruthy();
    expect(screen.getByText(/沒有待辦不等於已核准服務資格/)).toBeTruthy();
  });
  it("preserves staff and text search on card links, and resets controls for RSC query navigation", () => {
    const first = report();
    const { rerender } = render(<QualificationWorkspace report={first} />);
    const second = report(); second.filters = { staff: second.staffOptions[0].id, issue: "expired", query: "甲" };
    rerender(<QualificationWorkspace report={second} />);
    const link = screen.getByRole("link", { name: /^已過期：/ });
    const params = new URL(link.getAttribute("href")!, "https://example.invalid").searchParams;
    expect(params.get("staff")).toBe(second.filters.staff); expect(params.get("q")).toBe("甲");
    expect((screen.getByRole("combobox", { name: "員工" }) as HTMLSelectElement).value).toBe(second.filters.staff);
    expect((screen.getByRole("combobox", { name: "待辦分類" }) as HTMLSelectElement).value).toBe("expired");
    expect((screen.getByRole("searchbox", { name: "搜尋員工或證照" }) as HTMLInputElement).value).toBe("甲");
  });
});
