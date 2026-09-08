import { describe, expect, it } from "vitest";

import type { ClientMasterItem } from "@/lib/clients/master-types";

import { buildDemoClientToccSnapshot } from "./demo";
import {
  canRecordClientToccOn,
  filterClientToccSnapshot,
  projectClientToccSnapshot,
} from "./projection";
import {
  calculateToccValidThrough,
  parseClientToccAssessmentFields,
} from "./validation";

const clientId = "a1111111-1111-4111-8111-111111111111";

function client(
  id: string,
  overrides: Partial<ClientMasterItem> = {},
): ClientMasterItem {
  return {
    id,
    clientCode: `C-${id.slice(1, 4)}`,
    displayName: "測試個案",
    dateOfBirth: null,
    status: "active",
    serviceState: "active",
    admittedOn: "2026-01-01",
    endedOn: null,
    sourceSystem: "local",
    sourceAuthority: "local",
    sourceUpdatedAt: null,
    rowVersion: 1,
    updatedAt: "2026-09-01T01:00:00.000Z",
    editable: true,
    editBlockReason: null,
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    assessment_id: "b1111111-1111-4111-8111-111111111111",
    client_id: clientId,
    assessment_version: 2,
    assessment_date: "2026-08-31",
    valid_through: "2026-09-30",
    validity_rule_version: "calendar-month-asia-taipei-v1",
    validity_status: "current",
    result_status: "clear",
    symptom_summary: null,
    risk_summary: null,
    evidence_status: "not_required",
    action_status: "none_required",
    signed_at: "2026-08-31T02:00:00.000Z",
    ...overrides,
  };
}

describe("client TOCC validation and projection", () => {
  it("locks the versioned calendar-month rule including month-end clamps", () => {
    expect(calculateToccValidThrough("2026-01-31")).toBe("2026-02-28");
    expect(calculateToccValidThrough("2024-01-31")).toBe("2024-02-29");
    expect(calculateToccValidThrough("2026-08-31")).toBe("2026-09-30");
    expect(calculateToccValidThrough("2024-02-29")).toBe("2024-03-29");
  });

  it("requires human summaries and an aligned action without diagnosing", () => {
    expect(() =>
      parseClientToccAssessmentFields(
        {
          client_id: clientId,
          assessment_date: "2026-09-01",
          result_status: "monitor",
          symptom_summary: "",
          risk_summary: "",
          evidence_status: "pending",
          action_status: "pending",
        },
        "2026-09-01",
      ),
    ).toThrow(/至少要填寫症狀或風險摘要/u);
    expect(() =>
      parseClientToccAssessmentFields(
        {
          client_id: clientId,
          assessment_date: "2026-09-01",
          result_status: "action_required",
          symptom_summary: "發燒",
          risk_summary: null,
          evidence_status: "verified",
          action_status: "none_required",
        },
        "2026-09-01",
      ),
    ).toThrow(/不能選擇無需處置/u);
  });

  it("joins only the authorized directory and verifies date, formula and status", () => {
    const snapshot = projectClientToccSnapshot({
      clients: [client(clientId)],
      assessmentRows: [row()],
      generatedAt: "2026-09-01T03:00:00.000Z",
      todayTaipei: "2026-09-01",
      demo: false,
    });
    expect(snapshot.clients[0]?.latestAssessment).toMatchObject({
      assessmentVersion: 2,
      validThrough: "2026-09-30",
      source: "staff",
    });
    expect(snapshot.counts).toMatchObject({ current: 1, expired: 0, noRecord: 0 });
    expect(() =>
      projectClientToccSnapshot({
        clients: [client(clientId)],
        assessmentRows: [row({ client_id: "a9999999-9999-4999-8999-999999999999" })],
        generatedAt: "2026-09-01T03:00:00.000Z",
        todayTaipei: "2026-09-01",
        demo: false,
      }),
    ).toThrow("INVALID_CLIENT_TOCC_PROJECTION");
    expect(() =>
      projectClientToccSnapshot({
        clients: [client(clientId)],
        assessmentRows: [row({ valid_through: "2026-10-01" })],
        generatedAt: "2026-09-01T03:00:00.000Z",
        todayTaipei: "2026-09-01",
        demo: false,
      }),
    ).toThrow("INVALID_CLIENT_TOCC_PROJECTION");
  });

  it("disables pending-admission and out-of-lifecycle recording", () => {
    const pending = client(clientId, {
      serviceState: "pending_admission",
      admittedOn: null,
    });
    const snapshot = projectClientToccSnapshot({
      clients: [pending],
      assessmentRows: [],
      generatedAt: "2026-09-01T03:00:00.000Z",
      todayTaipei: "2026-09-01",
      demo: false,
    });
    expect(snapshot.clients[0]?.canRecord).toBe(false);
    expect(canRecordClientToccOn(snapshot.clients[0]!, "2026-09-01")).toBe(false);
    expect(
      canRecordClientToccOn(
        {
          clientStatus: "active",
          admittedOn: "2026-09-02",
          endedOn: null,
        },
        "2026-09-01",
      ),
    ).toBe(false);
  });

  it("filters without changing the synthetic read-only source", () => {
    const demo = buildDemoClientToccSnapshot();
    const filtered = filterClientToccSnapshot(demo, {
      query: "LOCAL-022",
      validity: "expired",
      result: "monitor",
    });
    expect(demo.demo).toBe(true);
    expect(filtered.clients).toHaveLength(1);
    expect(filtered.clients[0]?.latestAssessment?.source).toBe("staff");
  });
});

