import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(), aal2: vi.fn(), load: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/auth/context", () => ({ requireTenantContext: mocks.context, hasRecentAal2: mocks.aal2 }));
vi.mock("@/lib/daily-service-summary/snapshot", () => ({
  DailyServiceSummarySnapshotError: class DailyServiceSummarySnapshotError extends Error {},
  loadDailyServiceSummarySnapshot: mocks.load,
}));
vi.mock("@/components/app/staff-access-denied", () => ({ StaffAccessDenied: () => null }));
vi.mock("@/components/daily-service-summary/daily-service-summary-workspace", () => ({
  DailyServiceSummaryWorkspace: () => null,
}));

import { StaffAccessDenied } from "@/components/app/staff-access-denied";
import { DailyServiceSummaryWorkspace } from "@/components/daily-service-summary/daily-service-summary-workspace";
import { DailyServiceSummarySnapshotError } from "@/lib/daily-service-summary/snapshot";
import DailySummaryPage, { dynamic, generateMetadata } from "./page";

const context = {
  organizationId: "organization-one", branchId: "branch-one", userId: "user-one",
  displayName: "合成員工", roles: ["manager"], scopes: ["clients.read", "daily_service_summary.read"],
  assuranceLevel: "aal1", recentAal2At: null, demo: false,
};
const props = (query: Record<string, string> = {}) => ({
  params: Promise.resolve({}), searchParams: Promise.resolve({ date: "2026-09-07", ...query }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(context);
  mocks.aal2.mockResolvedValue(false);
  mocks.load.mockResolvedValue({ snapshotId: "synthetic-snapshot" });
});

describe("dedicated daily-summary route", () => {
  it("never prerenders a care snapshot and retains catalog metadata", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(generateMetadata().title).toBe("每日服務彙整");
  });

  it("refuses page access before reading a snapshot", async () => {
    mocks.context.mockResolvedValue({ ...context, scopes: [] });
    const result = await DailySummaryPage(props());
    expect(result.type).toBe(StaffAccessDenied);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.aal2).not.toHaveBeenCalled();
  });

  it("rechecks scope and filters on every authorized request", async () => {
    const result = await DailySummaryPage(props({ completeness: "incomplete" }));
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith(context, {
      serviceDate: "2026-09-07", clientId: null, completeness: "incomplete",
    });
    expect(result.type).toBe(DailyServiceSummaryWorkspace);
    expect(result.props).toMatchObject({
      snapshot: { snapshotId: "synthetic-snapshot" }, canExport: false, hasRecentAal2: false, loadError: false,
    });
  });

  it("does not query or show stale results for invalid filters", async () => {
    const result = await DailySummaryPage(props({ completeness: "surprise" }));
    expect(mocks.load).not.toHaveBeenCalled();
    expect(result.props).toMatchObject({ snapshot: null, loadError: true });
  });

  it("allows export only with scope and recent AAL2, and fails closed on snapshot error", async () => {
    mocks.context.mockResolvedValue({ ...context, scopes: [...context.scopes, "daily_service_summary.export"] });
    mocks.aal2.mockResolvedValue(true);
    const good = await DailySummaryPage(props());
    expect(good.props).toMatchObject({ canExport: true, hasRecentAal2: true });
    mocks.load.mockRejectedValueOnce(new DailyServiceSummarySnapshotError());
    const failed = await DailySummaryPage(props());
    expect(failed.props).toMatchObject({ snapshot: null, loadError: true });
  });
});
