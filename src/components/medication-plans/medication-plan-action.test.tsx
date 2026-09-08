// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getPageBySlug } from "@/lib/catalog";
import type {
  MedicationPlanClientOption,
  MedicationPlanRecord,
  MedicationPlanSnapshot,
} from "@/lib/medication-plans/types";

import { MedicationPlanAction, taipeiLocalToIso } from "./medication-plan-action";
import { MedicationPlansWorkspace } from "./medication-plans-workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const client: MedicationPlanClientOption = {
  id: "a1111111-1111-4111-8111-111111111111",
  code: "HX-021",
  displayName: "陳O華",
  status: "active",
  admittedOn: "2025-04-01",
  endedOn: null,
  canCreatePlan: true,
};

const activePlan: MedicationPlanRecord = {
  id: "b1000000-0000-4000-8000-000000000001",
  recordKey: "c1000000-0000-4000-8000-000000000001",
  version: 1,
  previousVersionId: null,
  clientId: client.id,
  medicationName: "Metformin",
  dose: 500,
  doseUnit: "mg",
  route: "口服",
  schedule: { times: ["08:00"] },
  highRisk: false,
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveTo: null,
  workflowState: "approved",
  submittedByCurrentActor: false,
  lifecycleState: "active",
  submittedAt: "2025-12-30T00:00:00.000Z",
  approvedAt: "2025-12-31T00:00:00.000Z",
  terminatedAt: null,
  terminationKind: null,
  terminationReason: null,
  replacementPlanId: null,
  rowVersion: 3,
};

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
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

describe("medication plan action browser boundary", () => {
  it("round-trips Taipei local time and rejects normalized impossible dates", () => {
    expect(taipeiLocalToIso("2026-02-28T08:30")).toBe(
      "2026-02-28T00:30:00.000Z",
    );
    expect(() => taipeiLocalToIso("2026-02-31T08:30")).toThrow(
      "INVALID_LOCAL_DATETIME",
    );
    expect(() => taipeiLocalToIso("2026-13-01T08:30")).toThrow(
      "INVALID_LOCAL_DATETIME",
    );
  });

  it("keeps the dialog open when a malicious 2xx receipt claims another client", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            requestId: "e1000000-0000-4000-8000-000000000001",
            status: "ok",
            data: {
              planId: "b1000000-0000-4000-8000-000000000010",
              clientId: "a2222222-2222-4222-8222-222222222222",
              recordKey: "c1000000-0000-4000-8000-000000000010",
              version: 1,
              rowVersion: 1,
              workflowState: "draft",
              effectiveFrom: "2026-09-02T02:00:00.000Z",
              replayed: false,
              persisted: true,
              demo: false,
            },
            errors: [],
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    render(
      <MedicationPlanAction
        canManage
        client={client}
        demo={false}
        generatedAt="2026-09-01T02:00:00.000Z"
        hasRecentAal2
        instance="malformed"
        kind="create"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "新增計畫" }));
    const dialog = screen.getByRole("dialog", { name: "新增計畫" });
    fireEvent.change(within(dialog).getByLabelText("藥物名稱"), {
      target: { value: "Metformin" },
    });
    fireEvent.change(within(dialog).getByLabelText("劑量"), {
      target: { value: "500" },
    });
    fireEvent.change(within(dialog).getByLabelText("單位"), {
      target: { value: "mg" },
    });
    fireEvent.change(within(dialog).getByLabelText("途徑"), {
      target: { value: "口服" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /我已核對藥物/u }));
    fireEvent.click(within(dialog).getByRole("button", { name: "新增計畫" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/伺服器回覆不完整/u);
    });
    expect(dialog.hasAttribute("open")).toBe(true);
  });

  it("still renders stop for the approved plan when a newer draft exists", () => {
    const draft: MedicationPlanRecord = {
      ...activePlan,
      id: "b1000000-0000-4000-8000-000000000002",
      version: 2,
      previousVersionId: activePlan.id,
      workflowState: "draft",
      lifecycleState: "draft",
      submittedAt: null,
      approvedAt: null,
      effectiveFrom: "2026-10-01T00:00:00.000Z",
      rowVersion: 1,
    };
    const snapshot: MedicationPlanSnapshot = {
      generatedAt: "2026-09-01T02:00:00.000Z",
      staleAfter: "2026-09-01T02:01:00.000Z",
      selectedClient: client,
      clients: [client],
      plans: [activePlan, draft],
      metrics: { active: 1, expiringSoon: 0, recentChanges: 0, pendingApproval: 0 },
      demo: false,
    };
    render(
      <MedicationPlansWorkspace
        canManage
        hasRecentAal2
        page={getPageBySlug("staff/daily-care/medication-plans")!}
        query=""
        snapshot={snapshot}
        status="all"
      />,
    );
    expect(screen.getAllByRole("button", { name: "停藥" }).length).toBe(2);
    expect(screen.queryByRole("button", { name: "建立新版" })).toBeNull();
  });
});
