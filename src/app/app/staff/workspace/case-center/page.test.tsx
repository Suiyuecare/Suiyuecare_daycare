import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  load: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: mocks.redirect,
}));
vi.mock("@/lib/auth/context", () => ({ requireTenantContext: mocks.context }));
vi.mock("@/lib/case-center/registry", () => ({
  CaseCenterRegistryError: class CaseCenterRegistryError extends Error {},
  loadCaseCenterSnapshot: mocks.load,
}));
vi.mock("@/components/app/staff-access-denied", () => ({
  StaffAccessDenied: () => null,
}));
vi.mock("@/components/core-care/case-center-workspace", () => ({
  CaseCenterWorkspace: () => null,
}));

import { StaffAccessDenied } from "@/components/app/staff-access-denied";
import { CaseCenterWorkspace } from "@/components/core-care/case-center-workspace";
import { CaseCenterRegistryError } from "@/lib/case-center/registry";

import CaseCenterPage, { dynamic, generateMetadata } from "./page";

const context = {
  organizationId: "organization-one",
  organizationName: "測試機構",
  branchId: "branch-one",
  branchName: "測試分站",
  userId: "user-one",
  displayName: "測試員工",
  roles: ["care_worker"],
  scopes: ["clients.read"],
  assuranceLevel: "aal1",
  recentAal2At: null,
  demo: false,
};

const serviceDate = "2026-10-02";
const props = (query: Record<string, string> = {}) => ({
  params: Promise.resolve({}),
  searchParams: Promise.resolve({ date: serviceDate, ...query }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(context);
  mocks.load.mockResolvedValue({ page: 1, marker: "case-snapshot" });
  mocks.redirect.mockImplementation((href: string) => { throw new Error(`REDIRECT:${href}`); });
});

describe("dedicated case-center route", () => {
  it("always renders with the request's current tenant context", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("uses the catalog title for route metadata", () => {
    expect(generateMetadata().title).toBe("個案中心");
  });

  it("returns access help before reading client data when clients.read is absent", async () => {
    mocks.context.mockResolvedValue({ ...context, scopes: [] });

    const result = await CaseCenterPage(props({ q: "private name" }));

    expect(result.type).toBe(StaffAccessDenied);
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith("staff");
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("passes normalized filters with the authenticated context and limits linked actions", async () => {
    const result = await CaseCenterPage(props({
      q: "  合成   個案  ",
      lifecycle: "active",
      service: "serving",
      responsible: "me",
    }));
    const expectedFilters = {
      date: serviceDate,
      query: "合成 個案",
      lifecycle: "active",
      service: "serving",
      responsible: "me",
      page: 1,
    };

    expect(mocks.load).toHaveBeenCalledExactlyOnceWith(context, expectedFilters);
    expect(result.type).toBe(CaseCenterWorkspace);
    expect(result.props).toMatchObject({
      filters: expectedFilters,
      loadError: false,
      snapshot: { page: 1, marker: "case-snapshot" },
      canOpenIntake: false,
      allowedDailyPages: [],
      allowedContinuationPages: [],
      canViewSummary: false,
      page: { number: 2, slug: "staff/workspace/case-center" },
    });
  });

  it("exposes only links authorized by the current scope", async () => {
    mocks.context.mockResolvedValue({
      ...context,
      scopes: [
        "clients.read",
        "clients.demographics.read",
        "attendance.read",
        "health.read",
        "care_records.read",
        "daily_service_summary.read",
      ],
    });

    const result = await CaseCenterPage(props());

    expect(result.props.canOpenIntake).toBe(true);
    expect(result.props.allowedDailyPages).toEqual([3, 6, 46]);
    expect(result.props.allowedContinuationPages).toEqual([]);
    expect(result.props.canViewSummary).toBe(true);
  });

  it("exposes continuation pages only from the current employee's permissions", async () => {
    mocks.context.mockResolvedValue({ ...context, scopes: ["clients.read", "medications.read", "social_work_records.read"] });
    const result = await CaseCenterPage(props());
    expect(result.props.allowedDailyPages).toEqual([]);
    expect(result.props.allowedContinuationPages).toEqual([7, 8, 28]);
  });

  it("redirects an out-of-range page while preserving parsed filters", async () => {
    mocks.load.mockResolvedValue({ page: 3 });

    await expect(CaseCenterPage(props({ q: "  合成 個案  ", lifecycle: "active", page: "999" })))
      .rejects.toThrow(/^REDIRECT:/);
    const [href] = mocks.redirect.mock.calls[0] as [string];
    const destination = new URL(href, "https://example.test");
    expect(destination.pathname).toBe("/app/staff/workspace/case-center");
    expect(Object.fromEntries(destination.searchParams)).toEqual({
      date: serviceDate,
      q: "合成 個案",
      lifecycle: "active",
      page: "3",
    });
    expect(mocks.load).toHaveBeenCalledWith(context, expect.objectContaining({ page: 999 }));
  });

  it("shows a known registry load error", async () => {
    mocks.load.mockRejectedValue(new CaseCenterRegistryError());

    const result = await CaseCenterPage(props());

    expect(result.type).toBe(CaseCenterWorkspace);
    expect(result.props.snapshot).toBeNull();
    expect(result.props.loadError).toBe(true);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("propagates unexpected registry errors", async () => {
    mocks.load.mockRejectedValue(new Error("unexpected registry failure"));

    await expect(CaseCenterPage(props())).rejects.toThrow("unexpected registry failure");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
