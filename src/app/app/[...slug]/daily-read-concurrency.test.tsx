// @vitest-environment jsdom
import { Children, isValidElement, Suspense, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import type { DailyCareSnapshot } from "@/lib/core-care/types";
import type { CareRosterSnapshot } from "@/lib/care-roster/types";
import type { DailyExpectedState } from "@/lib/client-weekly/daily-projection";

const mocks = vi.hoisted(() => ({ tenant: vi.fn(), snapshot: vi.fn(), roster: vi.fn(), expected: vi.fn(), authority: vi.fn(),
  SnapshotError: class CoreCareSnapshotError extends Error {} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ requireTenantContext: mocks.tenant, hasRecentAal2: vi.fn() }));
vi.mock("@/lib/core-care/snapshot", () => ({ loadDailyCareSnapshot: mocks.snapshot, CoreCareSnapshotError: mocks.SnapshotError }));
vi.mock("@/lib/care-roster/snapshot", () => ({ loadCareRosterSnapshot: mocks.roster }));
vi.mock("@/lib/client-weekly/daily-projection-loader", () => ({ loadDailyExpectedClients: mocks.expected }));
vi.mock("@/lib/auth/routine-care", () => ({ canUseRoutineCare: mocks.authority }));
import StaffCatalogPage from "./page";
import { DashboardWorkspace } from "@/components/workspace/dashboard-workspace";
import { CoreDailyWorkspace } from "@/components/core-care/core-daily-workspace";
import { DailyExpectedClients, DailyExpectedClientsLoading } from "@/components/client-weekly/daily-expected-clients";
import { projectDailyCareSnapshot } from "@/lib/core-care/projection";

const date = "2026-09-28";
const clientId = "c0000000-0000-4000-8000-000000000001";
const actor: TenantContext = { organizationId: "a0000000-0000-4000-8000-000000000001",
  branchId: "b0000000-0000-4000-8000-000000000001", userId: "d0000000-0000-4000-8000-000000000001",
  organizationName: "合成機構", branchName: "合成分支", displayName: "合成人員", roles: ["nurse"],
  scopes: ["clients.read", "health.read", "health.write", "care_records.read", "care_records.write", "attendance.read", "attendance.write"],
  assuranceLevel: "aal1", recentAal2At: null, demo: false };
const snapshot = projectDailyCareSnapshot({ serviceDate: date, generatedAt: `${date}T01:00:00Z`,
  clients: [{ id: clientId, client_code: "SYN-001", display_name: "合成個案" }],
  attendance: [], measurements: [], careDiaries: [], serviceEvents: [] });
const roster: CareRosterSnapshot = { status: "empty", manager: false, assignments: [], staffOptions: [], demo: false };
const expected: DailyExpectedState = { status: "unavailable", serviceDate: date };
const dashboard = "staff/workspace/dashboard";
const routinePages = [
  { slug: "staff/daily-care/vital-signs", permission: "health.write" },
  { slug: "staff/service-management/attendance", permission: "attendance.write" },
  { slug: "staff/daily-care/care-diary", permission: "care_records.write" },
];
const page = (slug: string, query: Record<string, string | string[] | undefined> = { date }) => StaffCatalogPage({
  params: Promise.resolve({ slug: slug.split("/") }), searchParams: Promise.resolve(query),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function findElement(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | null {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (child.type === type) return child;
    const nested = findElement(child.props.children as ReactNode, type);
    if (nested) return nested;
  }
  return null;
}
function props(node: ReactNode, type: unknown) {
  const element = findElement(node, type);
  if (!element) throw new Error("SYNTHETIC_EXPECTED_ELEMENT_MISSING");
  return element.props;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.tenant.mockResolvedValue(actor); mocks.snapshot.mockResolvedValue(snapshot);
  mocks.roster.mockResolvedValue(roster); mocks.expected.mockResolvedValue(expected); mocks.authority.mockResolvedValue(false);
});

describe("authorized daily page dispatch (deferred unit proof, not Next streaming/browser latency proof)", () => {
  it("starts all three dashboard reads before any unresolved read completes and reuses the exact expected promise", async () => {
    const core = deferred<DailyCareSnapshot>(); const assignments = deferred<CareRosterSnapshot>(); const planned = deferred<DailyExpectedState>();
    mocks.snapshot.mockReturnValue(core.promise); mocks.roster.mockReturnValue(assignments.promise); mocks.expected.mockReturnValue(planned.promise);
    let finished = false;
    const result = page(dashboard).then((element) => { finished = true; return element; });
    await vi.waitFor(() => {
      expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith(actor, date);
      expect(mocks.roster).toHaveBeenCalledExactlyOnceWith(actor, date);
      expect(mocks.expected).toHaveBeenCalledExactlyOnceWith(actor, date);
    });
    expect(finished).toBe(false);
    core.resolve(snapshot); assignments.resolve(roster);
    const element = await result;
    // The page returns its existing streamed section without waiting for names/plans.
    const streamed = props(element, Suspense);
    expect(isValidElement(streamed.fallback) && streamed.fallback.type).toBe(DailyExpectedClientsLoading);
    const expectedProps = props(element, DailyExpectedClients);
    expect(expectedProps).toMatchObject({ context: actor, serviceDate: date, statePromise: planned.promise });
    const panel = DailyExpectedClients({ context: actor, serviceDate: date, statePromise: planned.promise });
    planned.resolve(expected); expect((await panel).props.state).toBe(expected);
    expect(mocks.expected).toHaveBeenCalledTimes(1);
    expect(props(element, DashboardWorkspace)).toMatchObject({ snapshot, roster, loadError: false });
  });
  it("keeps a core source failure independent of successful roster and expected data", async () => {
    mocks.snapshot.mockRejectedValue(new mocks.SnapshotError());
    const element = await page(dashboard);
    expect(props(element, DashboardWorkspace)).toMatchObject({ snapshot: null, roster, loadError: true });
    expect(props(element, DailyExpectedClients).statePromise).toBe(mocks.expected.mock.results[0].value);
    expect(mocks.expected).toHaveBeenCalledTimes(1);
  });
  it("keeps a rejected roster independent of core and streamed expected data", async () => {
    mocks.roster.mockRejectedValue(new Error("private roster error"));
    const element = await page(dashboard);
    expect(props(element, DashboardWorkspace)).toMatchObject({ snapshot, roster: undefined, loadError: false });
    expect(props(element, DailyExpectedClients).statePromise).toBe(mocks.expected.mock.results[0].value);
  });
  it("observes early expected rejection without swallowing it or changing core state", async () => {
    const core = deferred<DailyCareSnapshot>(); const planned = deferred<DailyExpectedState>();
    mocks.snapshot.mockReturnValue(core.promise); mocks.expected.mockReturnValue(planned.promise);
    const result = page(dashboard);
    await vi.waitFor(() => expect(mocks.expected).toHaveBeenCalledTimes(1));
    const error = new Error("SYNTHETIC_EXPECTED_FAILURE"); planned.reject(error);
    await new Promise((done) => setTimeout(done, 0)); core.resolve(snapshot);
    const element = await result;
    expect(props(element, DashboardWorkspace)).toMatchObject({ snapshot, loadError: false });
    await expect(DailyExpectedClients({ context: actor, serviceDate: date, statePromise: planned.promise })).rejects.toBe(error);
    expect(mocks.expected).toHaveBeenCalledTimes(1);
  });
  it("does not reinterpret unexpected core failures as empty success", async () => {
    mocks.snapshot.mockRejectedValue(new Error("SYNTHETIC_PROGRAMMER_FAILURE"));
    await expect(page(dashboard)).rejects.toThrow("SYNTHETIC_PROGRAMMER_FAILURE");
    expect(mocks.roster).toHaveBeenCalledTimes(1); expect(mocks.expected).toHaveBeenCalledTimes(1);
  });
  it.each(routinePages)("starts $permission preflight while its core source is unresolved", async ({ slug, permission }) => {
    const core = deferred<DailyCareSnapshot>(); const authority = deferred<boolean>();
    mocks.snapshot.mockReturnValue(core.promise); mocks.authority.mockReturnValue(authority.promise);
    const result = page(slug);
    await vi.waitFor(() => {
      expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith(actor, date);
      expect(mocks.authority).toHaveBeenCalledWith(actor, permission);
    });
    expect(mocks.authority).toHaveBeenCalledTimes(permission === "care_records.write" ? 2 : 1);
    if (permission === "care_records.write") expect(mocks.authority).toHaveBeenCalledWith(actor, "care_records.read");
    core.resolve(snapshot); authority.resolve(false);
    expect(props(await result, CoreDailyWorkspace)).toMatchObject({ snapshot, canWrite: false, loadError: false, serviceDate: date });
    expect(mocks.roster).not.toHaveBeenCalled(); expect(mocks.expected).not.toHaveBeenCalled();
  });
  it("preserves denied authority and selected client/shift while a core read fails", async () => {
    mocks.snapshot.mockRejectedValue(new mocks.SnapshotError());
    const element = await page("staff/daily-care/care-diary", { date, client: clientId, shift: "morning" });
    expect(props(element, CoreDailyWorkspace)).toMatchObject({ snapshot: null, loadError: true, canWrite: false,
      selectedClientId: clientId, selectedShift: "morning", diaryLifecycle: undefined });
    expect(mocks.authority).toHaveBeenCalledWith(actor, "care_records.write");
    expect(mocks.authority).toHaveBeenCalledWith(actor, "care_records.read");
  });
  it("retains exact selected client/date filtering after concurrent authority read", async () => {
    mocks.authority.mockResolvedValue(true);
    const element = await page("staff/daily-care/vital-signs", { date, client: clientId, shift: "afternoon" });
    const view = props(element, CoreDailyWorkspace);
    expect(view).toMatchObject({ canWrite: true, serviceDate: date, selectedClientId: clientId, selectedShift: "afternoon" });
    expect((view.snapshot as DailyCareSnapshot).clients.map((client) => client.clientId)).toEqual([clientId]);
    expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith(actor, date);
  });
  it.each(routinePages)("does not start $permission preflight for an invalid selection", async ({ slug }) => {
    expect(props(await page(slug, { date, client: "not-a-client" }), "section").role).toBe("alert");
    expect(mocks.snapshot).not.toHaveBeenCalled(); expect(mocks.authority).not.toHaveBeenCalled();
  });
  it.each(routinePages)("keeps the page admission gate before $permission and all source reads", async ({ slug }) => {
    mocks.tenant.mockResolvedValue({ ...actor, scopes: [] });
    expect(props(await page(slug), "section")["aria-labelledby"]).toBe("access-denied-title");
    expect(mocks.snapshot).not.toHaveBeenCalled(); expect(mocks.authority).not.toHaveBeenCalled();
    expect(mocks.roster).not.toHaveBeenCalled(); expect(mocks.expected).not.toHaveBeenCalled();
  });
  it("does not start dashboard source reads before the authentication gate resolves", async () => {
    mocks.tenant.mockRejectedValue(new Error("LOGIN_REDIRECT"));
    await expect(page(dashboard)).rejects.toThrow("LOGIN_REDIRECT");
    expect(mocks.snapshot).not.toHaveBeenCalled(); expect(mocks.roster).not.toHaveBeenCalled(); expect(mocks.expected).not.toHaveBeenCalled();
  });
});
