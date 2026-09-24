// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoStaffManagementSnapshot } from "@/lib/staff-management/demo";

import {
  StaffEmploymentProposalForm,
  StaffProposalDecisionForm,
  StaffRoleApprovalForm,
  StaffRoleChangeForm,
  StaffTerminationProposalForm,
} from "./staff-management-actions";
import { StaffManagementWorkspace } from "./staff-management-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const ORG = "59000000-0000-4000-8000-000000000101";
const BRANCH = "59000000-0000-4000-8000-000000000102";
const REVIEWER = "59000000-0000-4000-8000-000000000099";
const filters = { status: "all" as const, roleId: null,
  qualification: "all" as const, query: "" };
const demoSnapshot = buildDemoStaffManagementSnapshot({
  organizationId: ORG, branchId: BRANCH, filters,
  now: new Date("2026-09-02T04:00:00.000Z"),
});
const liveSnapshot = { ...demoSnapshot, demo: false };
const page = staffPages.find((entry) => entry.number === 59)!;

function sent(call: unknown[]) {
  const init = call[1] as RequestInit;
  const headers = new Headers(init.headers);
  return {
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
    idempotencyKey: headers.get("idempotency-key"),
    governedAction: headers.get("x-staff-management-action"),
  };
}

function fillEmploymentProposal() {
  const employee = liveSnapshot.employees.find((item) =>
    item.membershipStatus === "active")!;
  fireEvent.change(screen.getByLabelText("員工"), {
    target: { value: employee.membershipId },
  });
  fireEvent.change(screen.getByLabelText("到職日"), {
    target: { value: employee.membershipStartsOn },
  });
  fireEvent.change(screen.getByLabelText("聘僱類型（人工文字）"), {
    target: { value: "合成人工聘僱" },
  });
  fireEvent.change(screen.getByLabelText("職務（人工文字）"), {
    target: { value: "合成照顧職務" },
  });
  fireEvent.change(screen.getByLabelText("登錄狀態（人工文字）"), {
    target: { value: "合成人工登錄中" },
  });
  fireEvent.change(screen.getByLabelText("異動理由"), {
    target: { value: "合成聘僱異動理由" },
  });
}

describe("Page 59 staff management UI boundary", () => {
  beforeEach(() => {
    refresh.mockReset();
    let sequence = 200;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `59000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("fails closed without one complete authorized snapshot", () => {
    render(<StaffManagementWorkspace canApproveEmployment={false}
      canApproveRoles={false} canApproveTermination={false}
      canManageEmployment={false} canManageRoles={false} canTerminate={false}
      currentUserId={REVIEWER} filters={filters} hasRecentAal2={false}
      loadError page={page} snapshot={null} />);
    expect(screen.getByRole("heading", { name: "無法取得員工管理快照" }))
      .toBeInTheDocument();
    expect(screen.queryByText("合成員工甲")).not.toBeInTheDocument();
  });

  it("shows synthetic read-only data and every unconfigured boundary honestly", () => {
    render(<StaffManagementWorkspace canApproveEmployment canApproveRoles
      canApproveTermination canManageEmployment canManageRoles canTerminate
      currentUserId={REVIEWER} filters={filters} hasRecentAal2
      loadError={false} page={page} snapshot={demoSnapshot} />);
    expect(screen.getByText(/展示模式：以下姓名、員編、職務、資格與撤銷回執均為合成資料/u))
      .toBeInTheDocument();
    expect(screen.getByText(/新增員工候選／邀請來源與 Auth 帳號建立尚未設定/u))
      .toBeInTheDocument();
    expect(screen.getByText(/資格到期前 30 日提醒與受限制服務規則尚未發布/u))
      .toBeInTheDocument();
    expect(screen.getByText(/Supabase Auth Admin 撤銷供應商目前未設定/u))
      .toBeInTheDocument();
    expect(screen.queryByText("建立聘僱／職務異動提案")).not.toBeInTheDocument();
    expect(screen.queryByText("新增員工")).not.toBeInTheDocument();
    expect(screen.queryByText(/即將到期 1/u)).not.toBeInTheDocument();
  });

  it("exposes equivalent desktop table and mobile-card identity details", () => {
    const { container } = render(<StaffManagementWorkspace
      canApproveEmployment={false} canApproveRoles={false}
      canApproveTermination={false} canManageEmployment={false}
      canManageRoles={false} canTerminate={false} currentUserId={REVIEWER}
      filters={filters} hasRecentAal2={false} loadError={false}
      page={page} snapshot={demoSnapshot} />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("合成員工甲")).toBeInTheDocument();
    expect(within(table).getByText(/1 筆已明確過期；服務資格未評估/u))
      .toBeInTheDocument();
    expect(container.querySelectorAll("a[href*='staff-certificates?staff=']"))
      .toHaveLength(demoSnapshot.employees.length * 2);
    expect(screen.getAllByText("合成員工甲").length).toBeGreaterThanOrEqual(2);
  });

  it("uses current system labels in employee views and filters without changing historical role evidence", () => {
    const systemRole = { roleId: "10000000-0000-4000-8000-000000000002",
      roleKey: "organization_manager", roleName: "舊版管理員", isSystem: true };
    const customRole = { roleId: "59000000-0000-4000-8000-000000000088",
      roleKey: "organization_manager", roleName: "機構自訂管理職", isSystem: false };
    const snapshot = { ...liveSnapshot,
      employees: liveSnapshot.employees.map((employee, index) => index === 0
        ? { ...employee, roles: [systemRole, customRole], roleCount: 2 } : employee),
      roleOptions: [...liveSnapshot.roleOptions, systemRole, customRole],
      roleOptionTotal: liveSnapshot.roleOptionTotal + 2,
      roleRequests: liveSnapshot.roleRequests.map((request) => ({ ...request,
        roleName: "歷史護理申請職稱" })),
    };
    const before = JSON.stringify(snapshot);
    render(<StaffManagementWorkspace canApproveEmployment={false} canApproveRoles={false}
      canApproveTermination={false} canManageEmployment={false} canManageRoles={false}
      canTerminate={false} currentUserId={REVIEWER} filters={filters} hasRecentAal2={false}
      loadError={false} page={page} snapshot={snapshot} />);
    const filter = within(screen.getByRole("form", { name: "篩選員工管理" }))
      .getByLabelText("角色");
    expect(filter.querySelector(`option[value="${systemRole.roleId}"]`))
      .toHaveTextContent("全機構管理員（多點管理）");
    expect(filter.querySelector(`option[value="${customRole.roleId}"]`))
      .toHaveTextContent("機構自訂管理職");
    expect(screen.getAllByText("全機構管理員（多點管理）、機構自訂管理職"))
      .toHaveLength(2);
    expect(screen.getByRole("heading", { name: "歷史護理申請職稱" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看 11 種標準職務與管理範圍" }))
      .not.toBeInTheDocument();
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("submits only the selected director role and never adds concurrent clinical roles automatically", async () => {
    const directorRole = { roleId: "10000000-0000-4000-8000-000000000011",
      roleKey: "branch_director", roleName: "機構主任", isSystem: true };
    const snapshot = { ...liveSnapshot,
      roleOptions: [...liveSnapshot.roleOptions, directorRole],
      roleOptionTotal: liveSnapshot.roleOptionTotal + 1,
    };
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffRoleChangeForm canManageRoles hasRecentAal2 snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText("員工"), {
      target: { value: snapshot.employees[0]!.membershipId },
    });
    fireEvent.change(screen.getByLabelText("角色"), { target: { value: directorRole.roleId } });
    expect(screen.getByText(/本次操作只處理所選的一個角色，不會連帶授權其他角色/u))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "凍結角色異動並送審" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sent(fetchMock.mock.calls[0]!).body).toEqual({
      action: "request_role", operation: "assign_role",
      target_membership_id: snapshot.employees[0]!.membershipId,
      target_role_id: directorRole.roleId,
      expected_membership_version: snapshot.employees[0]!.membershipVersion,
    });
  });

  it("retains exact operation and proposal keys after a 5xx unknown result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      requestId: "59000000-0000-4000-8000-000000000098", status: "error",
      data: null, errors: [{ code: "UNAVAILABLE", message: "retry" }],
    }, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffEmploymentProposalForm canManage hasRecentAal2
      snapshot={liveSnapshot} />);
    fillEmploymentProposal();
    fireEvent.click(screen.getByRole("button", { name: "凍結聘僱異動並送審" }));
    await screen.findByText(/結果未知.*相同操作鍵重試/u);
    const first = sent(fetchMock.mock.calls[0]!);
    expect(first.governedAction).toBe("propose_employment");

    fireEvent.click(screen.getByRole("button", { name: "凍結聘僱異動並送審" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const second = sent(fetchMock.mock.calls[1]!);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.body.proposal_key).toBe(first.body.proposal_key);

    fireEvent.input(screen.getByLabelText("職務（人工文字）"), {
      target: { value: "合成不同職務" },
    });
    fireEvent.click(screen.getByRole("button", { name: "凍結聘僱異動並送審" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const third = sent(fetchMock.mock.calls[2]!);
    expect(third.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(third.body.proposal_key).not.toBe(first.body.proposal_key);
  });

  it("binds termination and role actions to explicit governed headers and versions", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const active = liveSnapshot.employees.find((item) =>
      item.membershipStatus === "active")!;

    const termination = render(<StaffTerminationProposalForm canTerminate
      hasRecentAal2 snapshot={liveSnapshot} />);
    expect(screen.getByLabelText("離職生效日")).toHaveAttribute(
      "max", liveSnapshot.snapshotDate,
    );
    fireEvent.change(screen.getByLabelText("員工"), {
      target: { value: active.membershipId },
    });
    fireEvent.change(screen.getByLabelText("停用理由"), {
      target: { value: "合成立即停用理由" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送出立即離職停用提案" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(sent(fetchMock.mock.calls[0]!).governedAction).toBe("propose_termination");
    termination.unmount();

    render(<StaffRoleChangeForm canManageRoles hasRecentAal2
      snapshot={liveSnapshot} />);
    fireEvent.change(screen.getByLabelText("員工"), {
      target: { value: active.membershipId },
    });
    fireEvent.change(screen.getByLabelText("角色"), {
      target: { value: liveSnapshot.roleOptions[1]!.roleId },
    });
    fireEvent.click(screen.getByRole("button", { name: "凍結角色異動並送審" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const role = sent(fetchMock.mock.calls[1]!);
    expect(role.governedAction).toBe("request_role");
    expect(role.body).toMatchObject({ target_membership_id: active.membershipId,
      expected_membership_version: active.membershipVersion });
  });

  it("never exposes self-approval controls", () => {
    const proposal = liveSnapshot.proposals.find((item) => item.status === "pending")!;
    const roleRequest = liveSnapshot.roleRequests.find((item) => item.status === "pending")!;
    const proposalRender = render(<StaffProposalDecisionForm canApproveEmployment
      canApproveTermination currentUserId={proposal.requestedBy} hasRecentAal2
      snapshot={liveSnapshot} />);
    expect(screen.queryByText("獨立核准或駁回員工異動")).not.toBeInTheDocument();
    proposalRender.unmount();
    render(<StaffRoleApprovalForm canApproveRoles currentUserId={roleRequest.requestedBy}
      hasRecentAal2 snapshot={liveSnapshot} />);
    expect(screen.queryByText("獨立核准角色異動")).not.toBeInTheDocument();
  });

  it("does not expose a decision control for a migrated pending onboarding proposal", () => {
    const pending = liveSnapshot.proposals.find((item) => item.status === "pending")!;
    const onboardingSnapshot = { ...liveSnapshot,
      proposals: liveSnapshot.proposals.map((item) => item.proposalId === pending.proposalId
        ? { ...item, action: "onboard" as const, expectedMembershipVersion: 0,
          targetMembershipStatus: "active" as const }
        : item) };
    render(<StaffProposalDecisionForm canApproveEmployment canApproveTermination
      currentUserId={REVIEWER} hasRecentAal2 snapshot={onboardingSnapshot} />);
    expect(screen.queryByText("獨立核准或駁回員工異動")).not.toBeInTheDocument();
  });

  it("freezes the dedicated catalog permissions and honest action surface", () => {
    expect(page.requiredPermissions).toEqual([
      "staff_management.read", "staff_management.identity.read",
      "staff_management.employment.read", "staff_management.roles.read",
      "staff_management.qualifications.read", "staff_certificates.read",
    ]);
    expect(page.primaryActions).not.toContain("新增員工");
    expect(page.acceptance.join(" ")).toMatch(/onboarding.*fail closed/u);
    expect(page.acceptance.join(" ")).toMatch(/not_configured.*not_verified/u);
  });
});
