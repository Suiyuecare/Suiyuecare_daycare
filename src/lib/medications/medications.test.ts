import { describe, expect, it } from "vitest";

import { buildDemoMedicationAdministrationSnapshot } from "./demo";
import {
  filterMedicationAdministrationSnapshot,
  medicationClientOptions,
  projectMedicationAdministrationSnapshot,
  type MedicationAdministrationSourceRow,
} from "./projection";

const scheduled: MedicationAdministrationSourceRow = {
  administration_id: "11111111-1111-4111-8111-111111111111",
  client_id: "21111111-1111-4111-8111-111111111111",
  client_code: "C-001",
  client_display_name: "個案甲",
  medication_plan_id: "31111111-1111-4111-8111-111111111111",
  medication_name: "測試藥物",
  planned_dose: "1.0000",
  dose_unit: "錠",
  medication_route: "口服",
  high_risk: false,
  scheduled_for: "2026-09-01T01:00:00.000Z",
  occurred_at: null,
  execution_signed_at: null,
  status: "scheduled",
  actual_dose: null,
  actual_dose_unit: null,
  reason: null,
  execution_source: null,
  late_entry: false,
  requires_second_verification: false,
  recorded_by: null,
  recorded_by_name: null,
  second_verified_by: null,
  second_verified_by_name: null,
  second_verified_at: null,
  signed_at: null,
  finalization_state: "scheduled",
};

function snapshot(rows: readonly MedicationAdministrationSourceRow[]) {
  return projectMedicationAdministrationSnapshot({
    serviceDate: "2026-09-01",
    generatedAt: "2026-09-01T04:00:00.000Z",
    rows,
  });
}

describe("medication administration read projection", () => {
  it("keeps pending high-risk execution out of completed totals", () => {
    const pending = {
      ...scheduled,
      administration_id: "12222222-2222-4222-8222-222222222222",
      medication_plan_id: "32222222-2222-4222-8222-222222222222",
      high_risk: true,
      occurred_at: "2026-09-01T01:04:00.000Z",
      execution_signed_at: "2026-09-01T01:05:00.000Z",
      status: "administered",
      actual_dose: "1.0000",
      actual_dose_unit: "錠",
      execution_source: "staff",
      requires_second_verification: true,
      recorded_by: "41111111-1111-4111-8111-111111111111",
      recorded_by_name: "執行者",
      finalization_state: "pending_verification",
    } satisfies MedicationAdministrationSourceRow;
    const result = snapshot([scheduled, pending]);
    expect(result.counts).toEqual({
      due: 2,
      completed: 0,
      pending: 2,
      exceptions: 0,
    });
  });

  it("counts only terminal signatures as completed and exceptions independently", () => {
    const refused = {
      ...scheduled,
      administration_id: "13333333-3333-4333-8333-333333333333",
      medication_plan_id: "33333333-3333-4333-8333-333333333333",
      occurred_at: "2026-09-01T01:02:00.000Z",
      execution_signed_at: "2026-09-01T01:03:00.000Z",
      status: "refused",
      reason: "個案拒絕",
      execution_source: "staff",
      recorded_by: "41111111-1111-4111-8111-111111111111",
      recorded_by_name: "執行者",
      signed_at: "2026-09-01T01:03:00.000Z",
      finalization_state: "signed",
    } satisfies MedicationAdministrationSourceRow;
    expect(snapshot([scheduled, refused]).counts).toEqual({
      due: 2,
      completed: 1,
      pending: 1,
      exceptions: 1,
    });
  });

  it("filters client, outcome, and pending verification from the same snapshot", () => {
    const demo = buildDemoMedicationAdministrationSnapshot("2026-09-01");
    const pending = filterMedicationAdministrationSnapshot(demo, {
      status: "pending_verification",
    });
    expect(pending.rows).toHaveLength(1);
    expect(pending.counts.completed).toBe(0);
    const refused = filterMedicationAdministrationSnapshot(demo, {
      clientId: demo.rows.find((row) => row.status === "refused")!.clientId,
      status: "refused",
    });
    expect(refused.rows).toHaveLength(1);
    expect(refused.counts.exceptions).toBe(1);
  });

  it("exposes only approved minimal fields and unique client options", () => {
    const demo = buildDemoMedicationAdministrationSnapshot("2026-09-01");
    expect(Object.keys(demo.rows[0]!).sort()).toEqual([
      "actualDose",
      "actualDoseUnit",
      "clientCode",
      "clientDisplayName",
      "clientId",
      "doseUnit",
      "executionSignedAt",
      "executionSource",
      "executor",
      "finalizationState",
      "highRisk",
      "id",
      "lateEntry",
      "medicationName",
      "medicationPlanId",
      "occurredAt",
      "plannedDose",
      "reason",
      "requiresSecondVerification",
      "route",
      "scheduledFor",
      "secondVerifiedAt",
      "signedAt",
      "status",
      "verifier",
    ]);
    expect(medicationClientOptions(demo).length).toBe(4);
  });

  it("fails closed on dose/unit drift, missing exception reason, and invalid terminal evidence", () => {
    const malformed = [
      {
        ...scheduled,
        occurred_at: "2026-09-01T01:01:00.000Z",
        execution_signed_at: "2026-09-01T01:02:00.000Z",
        status: "administered",
        actual_dose: 999,
        actual_dose_unit: "錠",
        execution_source: "staff",
        recorded_by: "41111111-1111-4111-8111-111111111111",
        recorded_by_name: "執行者",
        signed_at: "2026-09-01T01:02:00.000Z",
        finalization_state: "signed",
      },
      {
        ...scheduled,
        occurred_at: "2026-09-01T01:01:00.000Z",
        execution_signed_at: "2026-09-01T01:02:00.000Z",
        status: "refused",
        execution_source: "staff",
        recorded_by: "41111111-1111-4111-8111-111111111111",
        recorded_by_name: "執行者",
        signed_at: "2026-09-01T01:02:00.000Z",
        finalization_state: "signed",
      },
      { ...scheduled, signed_at: "2026-09-01T01:02:00.000Z" },
    ];
    for (const row of malformed) {
      expect(() => snapshot([row as MedicationAdministrationSourceRow])).toThrow(
        "INVALID_MEDICATION_ADMINISTRATION_PROJECTION",
      );
    }
  });

  it("rejects duplicate plan plus scheduled slot projections", () => {
    expect(() =>
      snapshot([
        scheduled,
        {
          ...scheduled,
          administration_id: "14444444-4444-4444-8444-444444444444",
        },
      ]),
    ).toThrow("INVALID_MEDICATION_ADMINISTRATION_PROJECTION");
  });

  it("rejects rows outside the requested Taipei day and impossible service dates", () => {
    expect(() =>
      snapshot([
        {
          ...scheduled,
          scheduled_for: "2026-09-02T00:00:00+08:00",
        },
      ]),
    ).toThrow("INVALID_MEDICATION_ADMINISTRATION_PROJECTION");
    expect(() =>
      projectMedicationAdministrationSnapshot({
        serviceDate: "2026-02-31",
        generatedAt: "2026-09-01T04:00:00.000Z",
        rows: [],
      }),
    ).toThrow("INVALID_MEDICATION_ADMINISTRATION_PROJECTION");
  });

  it("rejects execution-source, late-entry, and signature timing drift", () => {
    const executed = {
      ...scheduled,
      occurred_at: "2026-09-01T01:01:00.000Z",
      execution_signed_at: "2026-09-01T01:02:00.000Z",
      status: "administered",
      actual_dose: "1.0000",
      actual_dose_unit: "錠",
      execution_source: "staff",
      recorded_by: "41111111-1111-4111-8111-111111111111",
      recorded_by_name: "執行者",
      signed_at: "2026-09-01T01:02:00.000Z",
      finalization_state: "signed",
    } satisfies MedicationAdministrationSourceRow;
    for (const row of [
      { ...executed, execution_source: "device" },
      { ...executed, late_entry: true },
      { ...executed, signed_at: "2026-09-01T01:03:00.000Z" },
    ]) {
      expect(() => snapshot([row as MedicationAdministrationSourceRow])).toThrow(
        "INVALID_MEDICATION_ADMINISTRATION_PROJECTION",
      );
    }
  });
});
