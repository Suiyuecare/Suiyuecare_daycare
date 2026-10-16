// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => {
  class SnapshotError extends Error {}
  return {
    context: vi.fn(), routine: vi.fn(), snapshot: vi.fn(), workspace: vi.fn(),
    SnapshotError,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ requireTenantContext: mock.context }));
vi.mock("@/lib/auth/routine-care", () => ({ canUseRoutineCare: mock.routine }));
vi.mock("@/lib/clients/master-snapshot", () => ({
  ClientMasterSnapshotError: mock.SnapshotError,
  loadClientMasterSnapshot: mock.snapshot,
}));
vi.mock("@/components/assessments/assessment-entry-workspace", () => ({
  AssessmentEntryWorkspace: (props: Record<string, unknown>) => {
    mock.workspace(props);
    return <div data-testid="assessment-entry">評估入口</div>;
  },
}));
vi.mock("@/components/app/staff-access-denied", () => ({
  StaffAccessDenied: () => <div role="alert">無權限</div>,
}));

import ExternalAssessmentResultsPage from "./page";

const clientId = "c1600000-0000-4000-8000-000000000001";
const client = {
  id: clientId,
  clientCode: "SYN-001",
  displayName: "合成測試個案",
  status: "active",
};
const scopes = [
  "clients.read", "care_records.read", "care_records.write",
  "questionnaire_cognition.read", "questionnaire_emotion.read", "questionnaire_fall.read",
  "questionnaire_nutrition.read", "questionnaire_adl.read", "questionnaire_swallowing.read",
];

async function view(query: Record<string, string | string[] | undefined> = {}) {
  return ExternalAssessmentResultsPage({ searchParams: Promise.resolve(query) });
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mock.context.mockResolvedValue({
    demo: false, organizationId: "synthetic-org", branchId: "synthetic-branch",
    userId: "synthetic-staff", assuranceLevel: "aal1", scopes,
  });
  mock.routine.mockResolvedValue(true);
  mock.snapshot.mockResolvedValue({ clients: [client] });
});

describe("external assessment results route", () => {
  it("rejects unauthorized and demo contexts before reading any client roster", async () => {
    for (const context of [
      { demo: false, scopes: [] },
      { demo: true, scopes },
    ]) {
      mock.context.mockResolvedValueOnce(context);
      render(await view({ client: clientId, externalInstrument: "swallowing" }));
      expect(screen.getByRole("alert")).toHaveTextContent("無權限");
      expect(mock.snapshot).not.toHaveBeenCalled();
      expect(mock.workspace).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("rejects invalid, duplicate, and unknown query values without reading the roster", async () => {
    for (const query of [
      { client: "not-a-uuid", externalInstrument: "swallowing" },
      { client: clientId, externalInstrument: "unapproved-tool" },
      { client: [clientId, clientId] },
      { client: clientId, unexpected: "1" },
    ]) {
      render(await view(query));
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("評估連結無效");
      expect(screen.getByRole("link", { name: "清除篩選" })).toHaveAttribute(
        "href", "/app/staff/assessments/external-results",
      );
      expect(mock.snapshot).not.toHaveBeenCalled();
      expect(mock.workspace).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("denies a known but unauthorized instrument before reading the client roster", async () => {
    render(await view({ client: clientId, externalInstrument: "chewing" }));
    expect(screen.getByRole("alert")).toHaveTextContent("無權限");
    expect(mock.snapshot).not.toHaveBeenCalled();
  });

  it("classifies a known roster failure without exposing an upstream error", async () => {
    mock.snapshot.mockRejectedValueOnce(new mock.SnapshotError("PRIVATE_SQL_OR_PHI"));
    render(await view({ client: clientId }));
    expect(screen.getByTestId("assessment-entry")).toBeVisible();
    expect(mock.workspace).toHaveBeenCalledWith(expect.objectContaining({
      clients: [], error: true, selectedClientId: clientId,
    }));
    expect(document.body.textContent).not.toContain("PRIVATE_SQL_OR_PHI");
  });

  it("opens a legitimate client and paper instrument without granting write when disallowed", async () => {
    mock.routine.mockImplementation(async (_context: unknown, permission: string) => permission === "care_records.read");
    mock.snapshot.mockResolvedValueOnce({ clients: [client, { ...client, id: "c1600000-0000-4000-8000-000000000002", status: "closed" }] });
    render(await view({ client: clientId.toUpperCase(), externalInstrument: "swallowing" }));
    expect(screen.getByTestId("assessment-entry")).toBeVisible();
    expect(mock.workspace).toHaveBeenCalledWith(expect.objectContaining({
      clients: [client], error: false, selectedClientId: clientId,
      initialExternalInstrument: "swallowing",
      readableExternalInstruments: expect.arrayContaining(["swallowing", "barthel_adl"]),
      writableExternalInstruments: [],
    }));
    expect(mock.snapshot).toHaveBeenCalledTimes(1);
  });

  it("only offers an instrument with its exact scope, and write needs mapped manage", async () => {
    mock.context.mockResolvedValueOnce({
      demo: false, organizationId: "synthetic-org", branchId: "synthetic-branch",
      userId: "synthetic-staff", assuranceLevel: "aal1",
      scopes: ["clients.read", "care_records.read", "care_records.write",
        "questionnaire_swallowing.read", "questionnaire_swallowing.manage"],
    });
    render(await view({ client: clientId, externalInstrument: "swallowing" }));
    expect(mock.workspace).toHaveBeenCalledWith(expect.objectContaining({
      readableExternalInstruments: ["swallowing"],
      writableExternalInstruments: ["swallowing"],
    }));
  });
});
