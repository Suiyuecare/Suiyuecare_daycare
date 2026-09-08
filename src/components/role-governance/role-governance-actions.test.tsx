// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  RoleGovernanceMembership,
  RoleGovernancePermission,
  RoleGovernanceRequest,
  RoleGovernanceRole,
} from "@/lib/role-governance/types";

import {
  RoleGovernanceApproveAction,
  RoleGovernanceRequestAction,
} from "./role-governance-actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const customRoleId = "81000000-0000-4000-8000-000000000003";
const staffMemberId = "81000000-0000-4000-8000-000000000004";
const familyMemberId = "81000000-0000-4000-8000-000000000005";

const roles: RoleGovernanceRole[] = [
  {
    id: customRoleId,
    roleKey: "activity_lead",
    name: "活動帶領人",
    description: null,
    system: false,
    active: true,
    permissionKeys: ["health.read"],
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    roleKey: "organization_manager",
    name: "機構管理員",
    description: null,
    system: true,
    active: true,
    permissionKeys: ["roles.manage"],
  },
  {
    id: "10000000-0000-4000-8000-000000000010",
    roleKey: "family",
    name: "家屬",
    description: null,
    system: true,
    active: true,
    permissionKeys: [],
  },
];
const permissions: RoleGovernancePermission[] = [
  { key: "health.read", description: "讀取健康資料", riskLevel: 2 },
  { key: "roles.manage", description: "角色治理", riskLevel: 3 },
];
const memberships: RoleGovernanceMembership[] = [
  {
    id: staffMemberId,
    branchId: "81000000-0000-4000-8000-000000000002",
    displayName: "王照服員",
    profileKind: "staff",
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: null,
    currentActor: false,
    roleIds: [],
  },
  {
    id: familyMemberId,
    branchId: "81000000-0000-4000-8000-000000000002",
    displayName: "陳家屬",
    profileKind: "family",
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: null,
    currentActor: false,
    roleIds: [],
  },
];

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("role governance request action", () => {
  it("exposes a readable reason when demo writes are disabled", () => {
    render(
      <RoleGovernanceRequestAction
        disabledReason="展示模式只讀，不會建立或核准任何申請"
        enabled={false}
        memberships={memberships}
        permissions={permissions}
        roles={roles}
      />,
    );
    const button = screen.getByRole("button", {
      name: /展示模式只讀，不會建立或核准任何申請/u,
    });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("title")).toBe(
      "展示模式只讀，不會建立或核准任何申請",
    );
  });

  it("pre-filters incompatible family assignments", () => {
    render(<RoleGovernanceRequestAction enabled memberships={memberships} permissions={permissions} roles={roles} />);
    fireEvent.click(screen.getByRole("button", { name: "建立變更申請" }));
    fireEvent.change(screen.getByLabelText(/變更類型/u), { target: { value: "assign_role" } });
    fireEvent.change(screen.getByLabelText(/成員/u), { target: { value: familyMemberId } });
    const roleSelect = screen.getByLabelText(/角色/u);
    expect(roleSelect.querySelector(`option[value="10000000-0000-4000-8000-000000000010"]`)).not.toBeNull();
    expect(roleSelect.querySelector(`option[value="10000000-0000-4000-8000-000000000002"]`)).toBeNull();
    expect(roleSelect.querySelector(`option[value="${customRoleId}"]`)).toBeNull();
  });

  it("never sends a browser-authored target role id for create_role and keeps exact retry key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: "81000000-0000-4000-8000-000000000010",
      status: "ok",
      data: { persisted: true, replayed: false, demo: false },
      errors: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RoleGovernanceRequestAction enabled memberships={memberships} permissions={permissions} roles={roles} />);
    fireEvent.click(screen.getByRole("button", { name: "建立變更申請" }));
    fireEvent.change(screen.getByLabelText(/角色代碼/u), { target: { value: "new_role" } });
    fireEvent.change(screen.getByLabelText(/角色名稱/u), { target: { value: "新角色" } });
    fireEvent.click(screen.getByRole("checkbox"));
    const form = screen.getByRole("dialog", { name: "建立變更申請" }).querySelector("form")!;
    fireEvent.submit(form);
    expect((await screen.findByRole("alert")).textContent).toMatch(/伺服器回覆不完整/u);
    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const firstBody = JSON.parse(String(firstInit.body)) as Record<string, unknown>;
    expect(firstBody).toEqual({
      operation: "create_role",
      role_key: "new_role",
      role_name: "新角色",
      role_description: null,
    });
    expect(firstBody).not.toHaveProperty("target_role_id");
    const firstKey = new Headers(firstInit.headers).get("Idempotency-Key");

    fireEvent.submit(form);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const retryKey = new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit).headers)
      .get("Idempotency-Key");
    expect(retryKey).toBe(firstKey);
    expect(screen.getByRole("dialog", { name: "建立變更申請" }).hasAttribute("open")).toBe(true);
  });

  it("prevents Escape cancellation while a request is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<RoleGovernanceRequestAction enabled memberships={memberships} permissions={permissions} roles={roles} />);
    fireEvent.click(screen.getByRole("button", { name: "建立變更申請" }));
    fireEvent.change(screen.getByLabelText(/角色代碼/u), { target: { value: "new_role" } });
    fireEvent.change(screen.getByLabelText(/角色名稱/u), { target: { value: "新角色" } });
    fireEvent.click(screen.getByRole("checkbox"));
    const dialog = screen.getByRole("dialog", { name: "建立變更申請" });
    fireEvent.submit(dialog.querySelector("form")!);
    await screen.findByRole("button", { name: "確認中…" });
    const cancel = new Event("cancel", { cancelable: true });
    expect(dialog.dispatchEvent(cancel)).toBe(false);
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(screen.getByRole("button", { name: "關閉" })).toHaveProperty("disabled", true);
  });
});

describe("role governance approval action", () => {
  const request: RoleGovernanceRequest = {
    id: "81000000-0000-4000-8000-000000000011",
    operation: "assign_role",
    targetRoleId: customRoleId,
    targetMembershipId: staffMemberId,
    targetPermissionKey: null,
    roleKey: null,
    roleName: null,
    roleDescription: null,
    status: "pending",
    requestedAt: "2026-09-01T08:00:00.000Z",
    requestedByCurrentActor: false,
    requesterLabel: "另一位授權人員",
    approvedAt: null,
    approvedByCurrentActor: false,
    approverLabel: null,
    appliedAt: null,
  };

  it("keeps a malformed 2xx approval open", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: "81000000-0000-4000-8000-000000000012",
      status: "ok",
      data: {
        governanceRequest: { id: request.id, status: "approved" },
        replayed: false,
        persisted: true,
        demo: false,
      },
      errors: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    render(<RoleGovernanceApproveAction enabled instance="desktop" request={request} />);
    fireEvent.click(screen.getByRole("button", { name: "獨立核准" }));
    fireEvent.click(screen.getByRole("checkbox"));
    const dialog = screen.getByRole("dialog", { name: /核准指派成員角色/u });
    fireEvent.submit(dialog.querySelector("form")!);
    expect((await screen.findByRole("alert")).textContent).toMatch(/伺服器回覆不完整/u);
    expect(dialog.hasAttribute("open")).toBe(true);
  });
});
