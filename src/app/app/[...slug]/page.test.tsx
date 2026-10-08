// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mock = vi.hoisted(() => {
  class SnapshotError extends Error {}
  return {
    requireContext: vi.fn(), medication: vi.fn(), tocc: vi.fn(),
    behavior: vi.fn(), abcd: vi.fn(), body: vi.fn(),
    SnapshotError,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({
  requireTenantContext: mock.requireContext,
  hasRecentAal2: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/auth/assessment-draft", () => ({
  canUseAssessmentDraft: vi.fn().mockResolvedValue(false),
  hasRecentBodyAssessmentAal2: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/medications/snapshot", () => ({
  loadMedicationAdministrationSnapshot: mock.medication,
  MedicationAdministrationSnapshotError: mock.SnapshotError,
}));
vi.mock("@/lib/client-tocc/snapshot", () => ({
  loadClientToccSnapshot: mock.tocc,
  ClientToccSnapshotError: mock.SnapshotError,
}));
vi.mock("@/lib/behavior-events/snapshot", () => ({
  loadBehaviorEventSnapshot: mock.behavior,
  BehaviorEventSnapshotError: mock.SnapshotError,
}));
vi.mock("@/lib/abcd-assessments/snapshot", () => ({
  loadAbcdAssessmentSnapshot: mock.abcd,
  AbcdAssessmentSnapshotError: mock.SnapshotError,
}));
vi.mock("@/lib/body-assessments/snapshot", () => ({
  loadBodyAssessmentSnapshot: mock.body,
  BodyAssessmentSnapshotError: mock.SnapshotError,
}));

import StaffCatalogPage from "./page";
import { getPageBySlug } from "@/lib/catalog";

const routes = [
  { slug: "staff/daily-care/medication-records", load: mock.medication, invalid: { status: "not-a-status" } },
  { slug: "staff/daily-care/client-tocc", load: mock.tocc, invalid: { validity: "not-a-validity" } },
  { slug: "staff/assessments/physical", load: mock.body, invalid: { unexpected: "1" } },
  { slug: "staff/assessments/behavior-emotion", load: mock.behavior, invalid: { unexpected: "1" } },
  { slug: "staff/assessments/abcd", load: mock.abcd, invalid: { unexpected: "1" } },
] as const;

const selectedClient = "11111111-1111-4111-8111-111111111111";
const selectedQueries = [
  { slug: "staff/daily-care/medication-records", query: { date: "2026-10-08", client: selectedClient, status: "all" } },
  { slug: "staff/daily-care/client-tocc", query: { q: "合成", validity: "all", result: "all" } },
  { slug: "staff/assessments/physical", query: { client: selectedClient, state: "all" } },
  { slug: "staff/assessments/behavior-emotion", query: { client: selectedClient, state: "all" } },
  { slug: "staff/assessments/abcd", query: { client: selectedClient, status: "all" } },
] as const;

async function view(slug: string, query: Record<string, string | string[]> = {}) {
  return StaffCatalogPage({
    params: Promise.resolve({ slug: slug.split("/") }),
    searchParams: Promise.resolve(query),
  } as Parameters<typeof StaffCatalogPage>[0]);
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mock.requireContext.mockResolvedValue({
    demo: false, userId: "staff", branchId: "wanhua", assuranceLevel: "aal1",
    scopes: ["clients.read", "medications.read", "health.read",
      "body_assessments.read", "behavior_events.read", "abcd_assessments.read"],
  });
});

describe("clinical work-page load states", () => {
  for (const route of routes) {
    it(`${route.slug}: invalid filters never start a clinical read`, async () => {
      render(await view(route.slug, route.invalid));
      expect(screen.getByRole("alert").textContent).toContain("篩選條件無效");
      expect(screen.getByRole("link", { name: "清除篩選" }).getAttribute("href"))
        .toBe(`/app/${route.slug}`);
      expect(route.load).not.toHaveBeenCalled();
    });

    it(`${route.slug}: snapshot failure is not disguised as an empty list`, async () => {
      route.load.mockRejectedValue(new mock.SnapshotError("PRIVATE_SQL_OR_PHI"));
      render(await view(route.slug));
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("資料暫時無法取得");
      expect(alert.textContent).not.toContain("PRIVATE_SQL_OR_PHI");
      expect(screen.getByRole("link", { name: "重新載入" })).toBeTruthy();
      expect(route.load).toHaveBeenCalledTimes(1);
    });
  }

  for (const route of selectedQueries) {
    it(`${route.slug}: retry keeps the selected clinical context, clear starts fresh`, async () => {
      const loader = routes.find((candidate) => candidate.slug === route.slug)!.load;
      loader.mockRejectedValue(new mock.SnapshotError("TRANSIENT_OUTAGE"));
      render(await view(route.slug, route.query));
      const path = `/app/${route.slug}`;
      const search = new URLSearchParams(route.query).toString();
      expect(screen.getByRole("link", { name: "重新載入" }).getAttribute("href"))
        .toBe(`${path}?${search}`);
      expect(screen.getByRole("link", { name: "清除篩選" }).getAttribute("href"))
        .toBe(path);
      expect(loader).toHaveBeenCalledTimes(1);
    });
  }

  it("denies page access before reading clinical data", async () => {
    mock.requireContext.mockResolvedValue({ demo: false, scopes: [] });
    render(await view(routes[0].slug));
    expect(mock.medication).not.toHaveBeenCalled();
  });

  it("does not block valid work-page query parameters", async () => {
    const page = getPageBySlug(routes[0].slug);
    expect(page).toBeTruthy();
    mock.medication.mockRejectedValue(new mock.SnapshotError("OUTAGE"));
    render(await view(routes[0].slug, { date: "2026-10-08", status: "all", client: "all" }));
    expect(mock.medication).toHaveBeenCalledTimes(1);
  });
});
