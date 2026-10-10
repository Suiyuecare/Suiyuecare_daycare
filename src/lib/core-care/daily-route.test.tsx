import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  canAccess: vi.fn(),
  inputs: vi.fn(),
  roster: vi.fn(),
  routine: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ requireTenantContext: mocks.context }));
vi.mock("@/lib/catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/catalog")>()),
  canAccessCatalogPage: mocks.canAccess,
}));
vi.mock("./daily-page-inputs", () => ({ loadCoreDailyPageInputs: mocks.inputs }));
vi.mock("@/lib/care-roster/snapshot", () => ({ loadCareRosterSnapshot: mocks.roster }));
vi.mock("@/lib/auth/routine-care", () => ({ canUseRoutineCare: mocks.routine }));
vi.mock("@/components/app/staff-access-denied", () => ({ StaffAccessDenied: () => null }));
vi.mock("@/components/core-care/core-daily-workspace", () => ({ CoreDailyWorkspace: () => null }));
vi.mock("@/components/core-care/care-diary-lifecycle", () => ({ CareDiaryLifecycle: () => null }));
vi.mock("@/components/care-reminders/care-reminder-card", () => ({ CareReminderCard: () => null }));

import { StaffAccessDenied } from "@/components/app/staff-access-denied";
import { CoreDailyWorkspace } from "@/components/core-care/core-daily-workspace";
import { CareDiaryLifecycle } from "@/components/core-care/care-diary-lifecycle";
import { getPageBySlug } from "@/lib/catalog";
import { buildDemoDailySnapshot } from "./demo";
import AttendancePage, { dynamic as attendanceDynamic, generateMetadata as attendanceMetadata } from
  "@/app/app/staff/service-management/attendance/page";
import VitalSignsPage, { dynamic as vitalsDynamic, generateMetadata as vitalsMetadata } from
  "@/app/app/staff/daily-care/vital-signs/page";
import CareDiaryPage, { dynamic as diaryDynamic, generateMetadata as diaryMetadata } from
  "@/app/app/staff/daily-care/care-diary/page";

const serviceDate = "2026-10-03";
const snapshot = buildDemoDailySnapshot(serviceDate);
const selectedClientId = snapshot.clients[1]!.clientId;
const context = {
  organizationId: "d0000000-0000-4000-8000-000000000001",
  branchId: "b0000000-0000-4000-8000-000000000001",
  userId: "a0000000-0000-4000-8000-000000000001",
  roles: ["care_worker"],
  scopes: ["clients.read", "attendance.read", "attendance.write", "health.read", "health.write",
    "care_records.read", "care_records.write", "care_records.sign"],
  assuranceLevel: "aal2",
  demo: false,
};

function pageProps(query: Record<string, string | string[] | undefined>) {
  return { params: Promise.resolve({}), searchParams: Promise.resolve(query) };
}

const routes = [
  { number: 46, slug: "staff/service-management/attendance", page: AttendancePage,
    metadata: attendanceMetadata, dynamic: attendanceDynamic },
  { number: 3, slug: "staff/daily-care/vital-signs", page: VitalSignsPage,
    metadata: vitalsMetadata, dynamic: vitalsDynamic },
  { number: 6, slug: "staff/daily-care/care-diary", page: CareDiaryPage,
    metadata: diaryMetadata, dynamic: diaryDynamic },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(context);
  mocks.canAccess.mockReturnValue(true);
  mocks.routine.mockResolvedValue(true);
  mocks.roster.mockResolvedValue({ status: "unavailable", assignments: [] });
  mocks.inputs.mockResolvedValue({ snapshot, canWriteRoutine: true, canReadDiary: true, canWriteNextStep: true, loadError: false });
});

describe.each(routes)("dedicated $slug route", ({ number, slug, page, metadata, dynamic }) => {
  it("keeps request-scoped rendering and catalog metadata", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(metadata()).toEqual({ title: getPageBySlug(slug)?.title, description: getPageBySlug(slug)?.description });
  });

  it("checks page access before loading any daily data", async () => {
    mocks.canAccess.mockReturnValue(false);
    const result = await page(pageProps({ date: serviceDate }));
    expect(result.type).toBe(StaffAccessDenied);
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith("staff");
    expect(mocks.inputs).not.toHaveBeenCalled();
  });

  it("rejects repeated or invalid selection without substituting another person", async () => {
    const result = await page(pageProps({ date: serviceDate, client: [selectedClientId, selectedClientId] }));
    expect(result.type).toBe("section");
    expect(result.props.role).toBe("alert");
    expect(mocks.inputs).not.toHaveBeenCalled();
  });

  it("keeps the selected person, date, shift and source permission on the route", async () => {
    const result = await page(pageProps({ date: serviceDate, client: selectedClientId, shift: "morning" }));
    expect(mocks.inputs).toHaveBeenCalledExactlyOnceWith(context, serviceDate, number);
    expect(result.type).toBe(CoreDailyWorkspace);
    expect(result.props).toMatchObject({
      page: { number }, serviceDate, selectedClientId, selectedShift: "morning",
      caregiverMode: true,
      validatedScope: { organizationId: context.organizationId, branchId: context.branchId, userId: context.userId },
      canWrite: true, canWriteNextStep: number !== 6, loadError: false, snapshot: { clients: [{ clientId: selectedClientId }] },
    });
    expect(result.props.snapshot.clients).toHaveLength(1);
    expect(result.props.diaryLifecycle?.type).toBe(number === 6 ? CareDiaryLifecycle : undefined);
  });

  it("does not show another client when a valid ID is outside the current snapshot", async () => {
    const unavailableId = "a9999999-9999-4999-8999-999999999999";
    const result = await page(pageProps({ date: serviceDate, client: unavailableId }));
    expect(result.type).toBe(CoreDailyWorkspace);
    expect(result.props.selectedClientId).toBe(unavailableId);
    expect(result.props.snapshot.clients).toEqual([]);
    expect(result.props.clientAttention).toBeUndefined();
    expect(result.props.diaryLifecycle).toBeUndefined();
  });
});

it("keeps the caregiver workflow for a care worker with an additional clinical role", async () => {
  mocks.context.mockResolvedValue({ ...context, roles: ["care_worker", "nurse"] });
  const result = await CareDiaryPage(pageProps({ date: serviceDate, client: selectedClientId }));
  expect(result.type).toBe(CoreDailyWorkspace);
  expect(result.props.caregiverMode).toBe(true);
  expect(result.props.careWorkerRole).toBe(true);
});

it.each([
  [AttendancePage, 3], [VitalSignsPage, 6],
] as const)("does not offer the following step when catalog page %s is forbidden", async (page, forbiddenPage) => {
  mocks.canAccess.mockImplementation((_context, entry: { number: number }) => entry.number !== forbiddenPage);
  const result = await page(pageProps({ date: serviceDate, client: selectedClientId }));
  expect(result.type).toBe(CoreDailyWorkspace);
  expect(result.props.canWriteNextStep).toBe(false);
});

it("does not expose diary lifecycle without diary read access", async () => {
  mocks.inputs.mockResolvedValue({ snapshot: { ...snapshot, sourceAccess: { ...snapshot.sourceAccess, careDiaries: false } },
    canWriteRoutine: false, canReadDiary: false, canWriteNextStep: false, loadError: false });
  const result = await CareDiaryPage(pageProps({ date: serviceDate, client: selectedClientId }));
  expect(result.props.diaryLifecycle).toBeUndefined();
  expect(result.props.canWrite).toBe(false);
});

it("offers a first-vital check-in only for the current scheduled caregiver slot", async () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const shift = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", hourCycle: "h23" }).format(new Date())) < 12 ? "morning" : "afternoon";
  const baseDaily = buildDemoDailySnapshot(today);
  const daily = { ...baseDaily, clients: baseDaily.clients.map((row) => row.clientId === selectedClientId
    ? { ...row, attendance: null, vitalSigns: null } : row) };
  mocks.inputs.mockResolvedValue({ snapshot: daily, canWriteRoutine: true, canReadDiary: true, canWriteNextStep: true, loadError: false });
  const slot = { clientId: selectedClientId, shift, state: "scheduled", staffUserId: context.userId, isServiceEligible: true };
  mocks.roster.mockResolvedValue({ status: "ready", assignments: [slot] });
  const allowed = await VitalSignsPage(pageProps({ date: today, client: selectedClientId }));
  expect(allowed.props.canOfferArrival).toBe(true);

  for (const badRoster of [
    { status: "unavailable", assignments: [] },
    { status: "ready", assignments: [{ ...slot, state: "cancelled" }] },
    { status: "ready", assignments: [{ ...slot, staffUserId: "a9999999-9999-4999-8999-999999999999" }] },
  ]) {
    mocks.roster.mockResolvedValue(badRoster);
    const denied = await VitalSignsPage(pageProps({ date: today, client: selectedClientId }));
    expect(denied.props.canOfferArrival).toBe(false);
  }
});
