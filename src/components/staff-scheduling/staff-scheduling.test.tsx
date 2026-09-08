// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoStaffSchedulingSnapshot } from "@/lib/staff-scheduling/demo";

import {
  StaffScheduleDecisionForm,
  StaffScheduleDraftForm,
} from "./staff-scheduling-actions";
import { StaffSchedulingWorkspace } from "./staff-scheduling-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const ORG = "63000000-0000-4000-8000-000000000101";
const BRANCH = "63000000-0000-4000-8000-000000000102";
const REVIEWER = "63000000-0000-4000-8000-000000000199";
const filters = { periodStart: "2026-09-02", periodEnd: "2026-09-08",
  staffMembershipId: null, status: "all" as const };
const demoSnapshot = buildDemoStaffSchedulingSnapshot({ organizationId: ORG,
  branchId: BRANCH, filters, now: new Date("2026-09-02T04:00:00.000Z") });
const liveSnapshot = { ...demoSnapshot, demo: false };
const page = staffPages.find((entry) => entry.number === 63)!;

function sent(call: unknown[]) {
  const init = call[1] as RequestInit;
  const headers = new Headers(init.headers);
  return { body: JSON.parse(String(init.body)) as Record<string, unknown>,
    key: headers.get("idempotency-key"),
    action: headers.get("x-staff-scheduling-action") };
}

function fillDraft() {
  fireEvent.change(screen.getByLabelText("員工"), {
    target: { value: liveSnapshot.staffOptions[0]!.staffMembershipId },
  });
  fireEvent.change(screen.getByLabelText("職務（機構人工規則）"), {
    target: { value: liveSnapshot.ruleVersion!.qualificationRules[0]!.roleText },
  });
  fireEvent.change(screen.getByLabelText("場地"), {
    target: { value: liveSnapshot.ruleVersion!.facilities[0]!.code },
  });
  fireEvent.change(screen.getByLabelText("車輛"), {
    target: { value: liveSnapshot.ruleVersion!.vehicles[0]!.code },
  });
  fireEvent.change(screen.getByLabelText("服務需求（人工文字）"), {
    target: { value: "合成服務需求" },
  });
}

describe("Page 63 staff scheduling UI boundary", () => {
  beforeEach(() => {
    refresh.mockReset();
    let sequence = 300;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `63000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("fails closed without one complete authorized snapshot", () => {
    render(<StaffSchedulingWorkspace canApprove={false} canManage={false}
      canOverride={false} currentUserId={REVIEWER} filters={filters}
      hasRecentAal2={false} loadError page={page} snapshot={null} />);
    expect(screen.getByRole("heading", { name: "無法取得排班快照" }))
      .toBeInTheDocument();
    expect(screen.queryByText("示範員工甲")).not.toBeInTheDocument();
  });

  it("labels synthetic mode, deterministic rules, Page 72, and disabled boundaries", () => {
    render(<StaffSchedulingWorkspace canApprove canManage canOverride
      currentUserId={REVIEWER} filters={filters} hasRecentAal2
      loadError={false} page={page} snapshot={demoSnapshot} />);
    expect(screen.getByRole("heading", { name: "智慧排班" })).toBeInTheDocument();
    expect(screen.getByText(/展示模式.*合成資料/u)).toBeInTheDocument();
    expect(screen.getByText(/規則輔助排班，不是 AI/u)).toBeInTheDocument();
    expect(screen.getByText(/人員資格只讀取第 72 頁終端證照投影/u))
      .toBeInTheDocument();
    expect(screen.getByText(/AI：未使用；自動發布：停用；匯出與離線：停用/u))
      .toBeInTheDocument();
    expect(screen.queryByText("建立規則檢查草稿／建立更正版"))
      .not.toBeInTheDocument();
  });

  it("shows equivalent desktop and mobile record evidence", () => {
    render(<StaffSchedulingWorkspace canApprove={false}
      canManage={false} canOverride={false} currentUserId={REVIEWER}
      filters={filters} hasRecentAal2={false} loadError={false}
      page={page} snapshot={demoSnapshot} />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("示範員工甲")).toBeInTheDocument();
    expect(within(table).getByText("1 項")).toBeInTheDocument();
    expect(screen.getAllByText("示範員工甲").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("合成日照活動支援")).toHaveLength(2);
  });

  it("shows all published manual rule inputs on desktop", () => {
    render(<StaffSchedulingWorkspace canApprove={false} canManage={false}
      canOverride={false} currentUserId={REVIEWER} filters={filters}
      hasRecentAal2={false} loadError={false} page={page} snapshot={demoSnapshot} />);
    const heading = screen.getByRole("heading", { name: /機構人工規則 v1/u });
    const panel = heading.closest("section")!;
    expect(within(panel).getByText("480 分鐘")).toBeInTheDocument();
    expect(within(panel).getByText("600 分鐘")).toBeInTheDocument();
    expect(within(panel).getByText(/合成照顧角色 → 合成示範證照/u))
      .toBeInTheDocument();
    expect(within(panel).getByText(/合成活動空間/u)).toBeInTheDocument();
    expect(within(panel).getByText(/合成接送車/u)).toBeInTheDocument();
  });

  it("fails draft creation closed when the institution rules are not configured", () => {
    const unavailable = { ...liveSnapshot, ruleConfigurationStatus: "not_configured" as const,
      ruleVersion: null, qualificationRuleStatus: "not_configured" as const,
      workTimeRuleStatus: "not_configured" as const, restRuleStatus: "not_configured" as const,
      facilityRuleStatus: "not_configured" as const, vehicleRuleStatus: "not_configured" as const,
      capacityRuleStatus: "not_configured" as const };
    render(<StaffScheduleDraftForm canManage hasRecentAal2 snapshot={unavailable} />);
    expect(screen.getByRole("heading", { name: "規則未完整配置，停止建立班表" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /建立草稿/u })).not.toBeInTheDocument();
  });

  it("retains exact entity and operation keys after an unknown 5xx result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      requestId: "63000000-0000-4000-8000-000000000198", status: "error",
      data: null, errors: [{ code: "UNAVAILABLE", message: "retry" }],
    }, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffScheduleDraftForm canManage hasRecentAal2 snapshot={liveSnapshot} />);
    fillDraft();
    fireEvent.click(screen.getByRole("button", { name: "檢查並建立草稿" }));
    await screen.findByText(/結果未知.*相同操作鍵重試/u);
    const first = sent(fetchMock.mock.calls[0]!);
    expect(first.action).toBe("submit_schedule");

    fireEvent.click(screen.getByRole("button", { name: "檢查並建立草稿" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const second = sent(fetchMock.mock.calls[1]!);
    expect(second.key).toBe(first.key);
    expect(second.body.schedule_key).toBe(first.body.schedule_key);

    fireEvent.input(screen.getByLabelText("服務需求（人工文字）"), {
      target: { value: "合成不同服務需求" },
    });
    fireEvent.click(screen.getByRole("button", { name: "檢查並建立草稿" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const third = sent(fetchMock.mock.calls[2]!);
    expect(third.key).not.toBe(first.key);
    expect(third.body.schedule_key).not.toBe(first.body.schedule_key);
  });

  it("never exposes self-review and never offers ordinary publish for conflicts", () => {
    const creator = liveSnapshot.records[0]!.createdBy;
    const self = render(<StaffScheduleDecisionForm canApprove canOverride
      currentUserId={creator} hasRecentAal2 snapshot={liveSnapshot} />);
    expect(screen.queryByText("獨立發布、駁回或衝突覆核")).not.toBeInTheDocument();
    self.unmount();
    const conflictedOnly = { ...liveSnapshot,
      records: [liveSnapshot.records.find((record) => record.conflictCount > 0)!],
      recordTotal: 1, readyTotal: 0, conflictedTotal: 1 };
    render(<StaffScheduleDecisionForm canApprove canOverride={false}
      currentUserId={REVIEWER} hasRecentAal2 snapshot={conflictedOnly} />);
    expect(screen.queryByRole("option", { name: "發布無衝突班表" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "有理由覆核衝突並發布" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "駁回並建立作廢版本" }))
      .toBeInTheDocument();
  });

  it("sends conflict override with its exact governed header and expected evidence", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const conflictedOnly = { ...liveSnapshot,
      records: [liveSnapshot.records.find((record) => record.conflictCount > 0)!],
      recordTotal: 1, readyTotal: 0, conflictedTotal: 1 };
    render(<StaffScheduleDecisionForm canApprove canOverride currentUserId={REVIEWER}
      hasRecentAal2 snapshot={conflictedOnly} />);
    fireEvent.change(screen.getByLabelText("審核／覆核理由"), {
      target: { value: "合成獨立覆核理由" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送出獨立審核" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const request = sent(fetchMock.mock.calls[0]!);
    expect(request.action).toBe("override_schedule");
    expect(request.body).toMatchObject({ decision: "override",
      expected_conflict_count: conflictedOnly.records[0]!.conflictCount,
      expected_rule_version_id: conflictedOnly.records[0]!.ruleVersionId });
  });

  it("freezes the dedicated catalog permissions and non-AI action surface", () => {
    expect(page.requiredPermissions).toEqual([
      "staff_scheduling.read", "staff_certificates.read",
    ]);
    expect(page.primaryActions).not.toContain("自動排班");
    expect(page.acceptance.join(" ")).toMatch(/manual_unstandardized.*fail closed/u);
    expect(page.acceptance.join(" ")).toMatch(/AI.*自動發布/u);
  });
});
