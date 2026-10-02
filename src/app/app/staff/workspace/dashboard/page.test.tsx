import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  canAccess: vi.fn(),
  daily: vi.fn(),
  roster: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({ requireTenantContext: mocks.context }));
vi.mock("@/lib/catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/catalog")>()),
  canAccessCatalogPage: mocks.canAccess,
}));
vi.mock("@/lib/core-care/snapshot", () => ({
  CoreCareSnapshotError: class CoreCareSnapshotError extends Error {},
  loadDailyCareSnapshot: mocks.daily,
}));
vi.mock("@/lib/care-roster/snapshot", () => ({
  loadCareRosterSnapshot: mocks.roster,
}));
vi.mock("@/components/app/staff-access-denied", () => ({
  StaffAccessDenied: () => null,
}));
vi.mock("@/components/workspace/dashboard-workspace", () => ({
  DashboardWorkspace: () => null,
}));
vi.mock("@/components/client-weekly/daily-expected-clients", () => ({
  DailyExpectedClients: () => null,
  DailyExpectedClientsLoading: () => null,
}));

import { StaffAccessDenied } from "@/components/app/staff-access-denied";
import { DailyExpectedClients } from "@/components/client-weekly/daily-expected-clients";
import { DashboardWorkspace } from "@/components/workspace/dashboard-workspace";
import { CoreCareSnapshotError } from "@/lib/core-care/snapshot";

import DashboardPage, { dynamic, generateMetadata } from "./page";

const context = {
  organizationId: "organization-one",
  organizationName: "測試機構",
  branchId: "branch-one",
  branchName: "測試分站",
  userId: "user-one",
  displayName: "測試員工",
  roles: ["branch_supervisor"],
  scopes: ["clients.read", "organization_profile.read", "audit.view"],
  assuranceLevel: "aal2",
  recentAal2At: null,
  demo: false,
};

const serviceDate = "2026-10-02";
const props = () => ({
  params: Promise.resolve({}),
  searchParams: Promise.resolve({ date: serviceDate }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(context);
  mocks.canAccess.mockReturnValue(true);
  mocks.daily.mockResolvedValue({ marker: "daily-snapshot" });
  mocks.roster.mockResolvedValue({ marker: "roster-snapshot" });
});

describe("dedicated dashboard route", () => {
  it("always renders with the request's current tenant context", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("uses the catalog title for route metadata", () => {
    expect(generateMetadata().title).toBe("首頁／工作儀表板");
  });

  it("returns access help before loading either snapshot when page access is denied", async () => {
    mocks.canAccess.mockReturnValue(false);

    const result = await DashboardPage(props());

    expect(result.type).toBe(StaffAccessDenied);
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith("staff");
    expect(mocks.daily).not.toHaveBeenCalled();
    expect(mocks.roster).not.toHaveBeenCalled();
  });

  it("passes the authenticated context and requested date through to both loaders and widgets", async () => {
    const result = await DashboardPage(props());
    const [workspace, expectedClients] = result.props.children;

    expect(mocks.daily).toHaveBeenCalledExactlyOnceWith(context, serviceDate);
    expect(mocks.roster).toHaveBeenCalledExactlyOnceWith(context, serviceDate);
    expect(workspace.type).toBe(DashboardWorkspace);
    expect(workspace.props).toMatchObject({
      canOpenReadiness: true,
      canViewManagementDetails: true,
      loadError: false,
      serviceDate,
      snapshot: { marker: "daily-snapshot" },
      roster: { marker: "roster-snapshot" },
    });
    expect(expectedClients.props.children.type).toBe(DailyExpectedClients);
    expect(expectedClients.props.children.props).toEqual({ context, serviceDate });
  });

  it("does not expose management actions without their separate role and scope", async () => {
    mocks.context.mockResolvedValue({ ...context, roles: ["care_worker"], scopes: ["clients.read"] });

    const result = await DashboardPage(props());
    const [workspace] = result.props.children;

    expect(workspace.props.canOpenReadiness).toBe(false);
    expect(workspace.props.canViewManagementDetails).toBe(false);
  });

  it("shows a known daily load error and tolerates an unavailable roster", async () => {
    mocks.daily.mockRejectedValue(new CoreCareSnapshotError());
    mocks.roster.mockRejectedValue(new Error("roster unavailable"));

    const result = await DashboardPage(props());
    const [workspace] = result.props.children;

    expect(workspace.props.snapshot).toBeNull();
    expect(workspace.props.loadError).toBe(true);
    expect(workspace.props.roster).toBeUndefined();
  });

  it("propagates unexpected daily errors", async () => {
    mocks.daily.mockRejectedValue(new Error("unexpected daily failure"));

    await expect(DashboardPage(props())).rejects.toThrow("unexpected daily failure");
  });
});
