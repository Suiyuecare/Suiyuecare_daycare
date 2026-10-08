// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mock = vi.hoisted(() => {
  class SnapshotError extends Error {}
  return {
    requireContext: vi.fn(), medication: vi.fn(), tocc: vi.fn(),
    behavior: vi.fn(), abcd: vi.fn(), body: vi.fn(),
    questionnaire: vi.fn(), routine: vi.fn(),
    SnapshotError,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth/context", () => ({
  requireTenantContext: mock.requireContext,
  hasRecentAal2: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/auth/assessment-draft", () => ({
  canUseAssessmentDraft: vi.fn().mockResolvedValue(false),
  hasRecentBodyAssessmentAal2: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/auth/routine-care", () => ({ canUseRoutineCare: mock.routine }));
vi.mock("@/lib/questionnaire-assessments/snapshot", () => ({
  loadQuestionnaireSnapshot: mock.questionnaire,
  QuestionnaireSnapshotError: mock.SnapshotError,
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

const questionnaireRoutes = [
  { slug: "staff/assessments/spmsq", formKey: "spmsq", instrument: "spmsq" },
  { slug: "staff/assessments/gds", formKey: "gds_15", instrument: "gds" },
  { slug: "staff/assessments/fall-risk", formKey: "fall_risk_taipei_115", instrument: "fall_risk" },
  { slug: "staff/assessments/nsi", formKey: "nsi_determine", instrument: "nsi" },
  { slug: "staff/assessments/barthel-adl", formKey: "barthel_adl", instrument: "barthel_adl" },
  { slug: "staff/assessments/iadl", formKey: "lawton_iadl", instrument: "iadl" },
  { slug: "staff/assessments/swallowing", formKey: "eat10_swallowing", instrument: "swallowing" },
  { slug: "staff/assessments/bsrs", formKey: "bsrs5", instrument: "bsrs" },
  { slug: "staff/professional-care/mna", formKey: "mna_sf", instrument: "mna" },
] as const;
const questionnaireClientId = "c1600000-0000-4000-8000-000000000001";

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
      "body_assessments.read", "behavior_events.read", "abcd_assessments.read",
      "questionnaire_cognition.read", "questionnaire_emotion.read", "questionnaire_fall.read",
      "questionnaire_nutrition.read", "questionnaire_adl.read", "questionnaire_swallowing.read"],
  });
  mock.routine.mockResolvedValue(true);
});

describe("shared questionnaire page load classification and paper entry", () => {
  for (const route of questionnaireRoutes) {
    it(`${route.slug}: invalid filters never query questionnaire data`, async () => {
      render(await view(route.slug, { externalInstrument: route.instrument }));
      expect(screen.getByRole("alert")).toHaveTextContent("篩選條件無效");
      expect(screen.getByRole("link", { name: "清除篩選" }).getAttribute("href"))
        .toBe(`/app/${route.slug}`);
      expect(mock.questionnaire).not.toHaveBeenCalled();
    });

    it(`${route.slug}: a snapshot failure stays a retryable error, not an empty roster`, async () => {
      mock.questionnaire.mockRejectedValueOnce(new mock.SnapshotError("PRIVATE_SQL_OR_PHI"));
      render(await view(route.slug));
      expect(screen.getByRole("alert")).toHaveTextContent("暫時無法載入");
      expect(screen.getByRole("link", { name: "重新載入" })).toBeTruthy();
      expect(document.body.textContent).not.toContain("PRIVATE_SQL_OR_PHI");
      expect(mock.questionnaire).toHaveBeenCalledWith(expect.anything(), route.formKey, null);
    });

    it(`${route.slug}: selected client can reach the separate paper-result route`, async () => {
      mock.questionnaire.mockResolvedValueOnce({
        formKey: route.formKey,
        generatedAt: "2026-10-08T00:00:00Z",
        matchingTotal: 1,
        clients: [{
          clientId: questionnaireClientId, displayName: "合成測試個案",
          serviceStatus: "active", latest: null,
        }],
      });
      render(await view(route.slug, { client: questionnaireClientId }));
      expect(screen.getByRole("link", { name: "有紙本結果？登錄" }).getAttribute("href"))
        .toBe(`/app/staff/assessments/external-results?client=${questionnaireClientId}&externalInstrument=${route.instrument}#external-result-entry`);
      expect(mock.questionnaire).toHaveBeenCalledWith(expect.anything(), route.formKey, questionnaireClientId);
    });
  }

  it("denies a questionnaire before any roster lookup when its read scope is absent", async () => {
    mock.requireContext.mockResolvedValueOnce({ demo: false, scopes: ["clients.read"] });
    render(await view(questionnaireRoutes[0].slug));
    expect(mock.questionnaire).not.toHaveBeenCalled();
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
