import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import { buildDemoMedicationPlanSnapshot } from "./demo";
import {
  parseCreateMedicationPlanDraft,
  parseMedicationPlanActionSuccess,
  parseStopMedicationPlan,
  parseStopMedicationPlanResult,
  parseSubmitMedicationPlanResult,
} from "./parser";
import {
  medicationPlanActionEligibility,
  projectMedicationPlanSnapshot,
  type MedicationPlanSourceRow,
} from "./projection";
import type { MedicationPlanClientOption } from "./types";

const client: MedicationPlanClientOption = {
  id: "a1111111-1111-4111-8111-111111111111",
  code: "HX-021",
  displayName: "陳O華",
  status: "active",
  admittedOn: "2025-04-01",
  endedOn: null,
  canCreatePlan: true,
};

function activeRow(
  override: Partial<MedicationPlanSourceRow> = {},
): MedicationPlanSourceRow {
  return {
    plan_id: "b1000000-0000-4000-8000-000000000001",
    record_key: "c1000000-0000-4000-8000-000000000001",
    version: 1,
    previous_version_id: null,
    client_id: client.id,
    medication_name: "Metformin",
    dose: 500,
    dose_unit: "mg",
    medication_route: "口服",
    schedule: { times: ["20:00", "08:00"] },
    high_risk: false,
    effective_from: "2026-01-01T00:00:00+08:00",
    effective_to: null,
    workflow_state: "approved",
    submitted_by_current_actor: false,
    lifecycle_state: "active",
    submitted_at: "2025-12-30T08:00:00+08:00",
    approved_at: "2025-12-31T08:00:00+08:00",
    terminated_at: null,
    termination_kind: null,
    termination_reason: null,
    replacement_plan_id: null,
    row_version: 3,
    ...override,
  };
}

describe("medication plan input boundary", () => {
  it("accepts only business fields and canonicalizes schedule and timestamps", () => {
    const parsed = parseCreateMedicationPlanDraft(
      {
        client_id: client.id,
        previous_plan_id: null,
        medication_name: " Metformin ",
        dose: 500,
        dose_unit: " mg ",
        route: " 口服 ",
        schedule_times: ["20:00", "08:00"],
        high_risk: false,
        effective_from: "2026-09-03T08:00:00+08:00",
        effective_to: null,
      },
      "d1000000-0000-4000-8000-000000000001",
    );

    expect(parsed).toMatchObject({
      clientId: client.id,
      medicationName: "Metformin",
      schedule: { times: ["08:00", "20:00"] },
      effectiveFrom: "2026-09-03T00:00:00.000Z",
    });
  });

  it.each([
    "organization_id",
    "branch_id",
    "actor_id",
    "source_system",
    "medication_key",
    "schedule_key",
    "content_hash",
    "signed_by",
    "challenge_id",
  ])("rejects forbidden caller field %s", (field) => {
    expect(() =>
      parseCreateMedicationPlanDraft(
        {
          client_id: client.id,
          medication_name: "Metformin",
          dose: 500,
          dose_unit: "mg",
          route: "口服",
          schedule_times: ["08:00"],
          high_risk: false,
          effective_from: "2026-09-03T08:00:00+08:00",
          [field]: "forged",
        },
        "d1000000-0000-4000-8000-000000000002",
      ),
    ).toThrow(IntegrationError);
  });

  it("requires unique schedule times, a UUID idempotency key, and a forward period", () => {
    const body = {
      client_id: client.id,
      medication_name: "Metformin",
      dose: 500,
      dose_unit: "mg",
      route: "口服",
      schedule_times: ["08:00", "08:00"],
      high_risk: false,
      effective_from: "2026-09-03T08:00:00+08:00",
      effective_to: "2026-09-03T07:00:00+08:00",
    };
    expect(() => parseCreateMedicationPlanDraft(body, "not-a-uuid")).toThrow(
      IntegrationError,
    );
    expect(() =>
      parseCreateMedicationPlanDraft(
        { ...body, schedule_times: ["08:00"] },
        "d1000000-0000-4000-8000-000000000003",
      ),
    ).toThrow(IntegrationError);
  });

  it("keeps the stop body exact and requires the optimistic row version", () => {
    const parsed = parseStopMedicationPlan(
      {
        medication_plan_id: "b1000000-0000-4000-8000-000000000001",
        expected_row_version: 3,
        reason: "依最新指示停藥",
      },
      "d1000000-0000-4000-8000-000000000004",
    );
    expect(parsed.expectedRowVersion).toBe(3);
    expect(() =>
      parseStopMedicationPlan(
        {
          medication_plan_id: parsed.medicationPlanId,
          expected_row_version: 3,
          reason: parsed.reason,
          client_id: client.id,
        },
        parsed.idempotencyKey,
      ),
    ).toThrow(IntegrationError);
  });

  it("rejects zero/multiple mutation rows and validates the stop ledger version", () => {
    expect(() =>
      parseSubmitMedicationPlanResult(
        [],
        "b1000000-0000-4000-8000-000000000001",
        1,
      ),
    ).toThrow(IntegrationError);
    expect(() =>
      parseStopMedicationPlanResult(
        {
          plan_id: "b1000000-0000-4000-8000-000000000001",
          client_id: client.id,
          record_key: "c1000000-0000-4000-8000-000000000001",
          version: 1,
          row_version: 4,
          lifecycle_state: "stopped",
          stopped_at: "2026-09-01T08:00:00+08:00",
          replayed: false,
        },
        "b1000000-0000-4000-8000-000000000001",
        3,
      ),
    ).toThrow(IntegrationError);
  });
});

describe("medication plan snapshot projection", () => {
  it("renders all governed lifecycle labels, lineage, high risk, and stop reason", () => {
    const snapshot = buildDemoMedicationPlanSnapshot(
      client.id,
      new Date("2026-09-01T10:00:00+08:00"),
    );
    expect(new Set(snapshot.plans.map((plan) => plan.lifecycleState))).toEqual(
      new Set([
        "draft",
        "submitted",
        "scheduled",
        "active",
        "expired",
        "stopped",
        "replaced",
      ]),
    );
    expect(snapshot.plans.some((plan) => plan.highRisk)).toBe(true);
    expect(
      snapshot.plans.find((plan) => plan.lifecycleState === "submitted")
        ?.submittedByCurrentActor,
    ).toBe(true);
    expect(
      snapshot.plans.find((plan) => plan.lifecycleState === "stopped")
        ?.terminationReason,
    ).toBe("依最新用藥指示停止此計畫");
    const secondVersion = snapshot.plans.find((plan) => plan.version === 2);
    expect(secondVersion?.previousVersionId).toBe(
      "b1000000-0000-4000-8000-000000000001",
    );
  });

  it("fails closed when a row belongs to another client or no selected client exists", () => {
    expect(() =>
      projectMedicationPlanSnapshot({
        rows: [
          activeRow({
            client_id: "a2222222-2222-4222-8222-222222222222",
          }),
        ],
        clients: [client],
        selectedClient: client,
        generatedAt: "2026-09-01T10:00:00+08:00",
        demo: false,
      }),
    ).toThrow("INVALID_MEDICATION_PLAN_PROJECTION");
    expect(() =>
      projectMedicationPlanSnapshot({
        rows: [activeRow()],
        clients: [],
        selectedClient: null,
        generatedAt: "2026-09-01T10:00:00+08:00",
        demo: false,
      }),
    ).toThrow("INVALID_MEDICATION_PLAN_PROJECTION");
  });

  it("requires a replacement to be the immediate successor in the same stream", () => {
    const successor = activeRow({
      plan_id: "b1000000-0000-4000-8000-000000000003",
      version: 3,
      previous_version_id: "b1000000-0000-4000-8000-000000000001",
    });
    expect(() =>
      projectMedicationPlanSnapshot({
        rows: [
          activeRow({
            lifecycle_state: "replaced",
            terminated_at: "2026-08-01T08:00:00+08:00",
            termination_kind: "replaced",
            termination_reason: "新版取代",
            replacement_plan_id: successor.plan_id,
          }),
          successor,
        ],
        clients: [client],
        selectedClient: client,
        generatedAt: "2026-09-01T10:00:00+08:00",
        demo: false,
      }),
    ).toThrow("INVALID_MEDICATION_PLAN_PROJECTION");
  });

  it("keeps a prior plan active while a replacement cutover is still future", () => {
    const replacement = activeRow({
      plan_id: "b1000000-0000-4000-8000-000000000002",
      version: 2,
      previous_version_id: "b1000000-0000-4000-8000-000000000001",
      effective_from: "2026-10-01T08:00:00+08:00",
      lifecycle_state: "scheduled",
    });
    const snapshot = projectMedicationPlanSnapshot({
      rows: [
        activeRow({
          terminated_at: "2026-10-01T08:00:00+08:00",
          termination_kind: "replaced",
          termination_reason: "排定換藥",
          replacement_plan_id: replacement.plan_id,
        }),
        replacement,
      ],
      clients: [client],
      selectedClient: client,
      generatedAt: "2026-09-04T10:00:00+08:00",
      demo: false,
    });
    expect(snapshot.plans.map((plan) => plan.lifecycleState).sort()).toEqual([
      "active",
      "scheduled",
    ]);
    const target = snapshot.plans.find((plan) => plan.id === replacement.plan_id)!;
    expect(
      medicationPlanActionEligibility(
        target,
        snapshot.plans,
        snapshot.generatedAt,
      ),
    ).toMatchObject({
      lockedByFutureCutover: true,
      canRevise: false,
      canStop: false,
    });
  });

  it("keeps stop available on an approved plan when only a newer draft exists", () => {
    const draft = activeRow({
      plan_id: "b1000000-0000-4000-8000-000000000002",
      version: 2,
      previous_version_id: "b1000000-0000-4000-8000-000000000001",
      workflow_state: "draft",
      lifecycle_state: "draft",
      submitted_at: null,
      approved_at: null,
      effective_from: "2026-10-01T08:00:00+08:00",
      row_version: 1,
    });
    const snapshot = projectMedicationPlanSnapshot({
      rows: [activeRow(), draft],
      clients: [client],
      selectedClient: client,
      generatedAt: "2026-09-01T10:00:00+08:00",
      demo: false,
    });
    const approved = snapshot.plans.find((plan) => plan.version === 1)!;
    expect(
      medicationPlanActionEligibility(
        approved,
        snapshot.plans,
        snapshot.generatedAt,
      ),
    ).toMatchObject({
      latestVersion: false,
      canRevise: false,
      canStop: true,
    });
  });

  it("marks a non-admitted active client as ineligible for new plans", () => {
    const invalidClient = {
      ...client,
      admittedOn: null,
      canCreatePlan: true,
    };
    expect(() =>
      projectMedicationPlanSnapshot({
        rows: [],
        clients: [invalidClient],
        selectedClient: invalidClient,
        generatedAt: "2026-09-01T10:00:00+08:00",
        demo: false,
      }),
    ).toThrow("INVALID_MEDICATION_PLAN_PROJECTION");
  });
});

describe("medication plan browser receipt boundary", () => {
  const requestId = "e1000000-0000-4000-8000-000000000001";

  it("accepts only a complete create receipt linked to the selected client and request", () => {
    const envelope = {
      requestId,
      status: "ok",
      data: {
        planId: "b1000000-0000-4000-8000-000000000010",
        clientId: client.id,
        recordKey: "c1000000-0000-4000-8000-000000000010",
        version: 1,
        rowVersion: 1,
        workflowState: "draft",
        effectiveFrom: "2026-09-03T00:00:00.000Z",
        replayed: false,
        persisted: true,
        demo: false,
      },
      errors: [],
    };
    expect(
      parseMedicationPlanActionSuccess(envelope, {
        kind: "create",
        clientId: client.id,
        requestedEffectiveFrom: "2026-09-03T08:00:00+08:00",
      }).data,
    ).toMatchObject({ clientId: client.id, version: 1, rowVersion: 1 });
    for (const malicious of [
      { ...envelope, requestId: "not-a-uuid" },
      { ...envelope, errors: [{ code: "warning", message: "ignored" }] },
      { ...envelope, extra: "caller-controlled" },
      { ...envelope, data: { ...envelope.data, clientId: "a2222222-2222-4222-8222-222222222222" } },
      { ...envelope, data: { ...envelope.data, version: 9 } },
      { ...envelope, data: { ...envelope.data, effectiveFrom: "2026-09-04T00:00:00.000Z" } },
    ]) {
      expect(() =>
        parseMedicationPlanActionSuccess(malicious, {
          kind: "create",
          clientId: client.id,
          requestedEffectiveFrom: "2026-09-03T08:00:00+08:00",
        }),
      ).toThrow("INVALID_MEDICATION_PLAN_ACTION_RESPONSE");
    }
  });

  it("rejects a 2xx action receipt that changes the governed plan lineage or version", () => {
    const snapshot = projectMedicationPlanSnapshot({
      rows: [activeRow({ workflow_state: "submitted", lifecycle_state: "submitted", approved_at: null, row_version: 2 })],
      clients: [client],
      selectedClient: client,
      generatedAt: "2026-09-01T10:00:00+08:00",
      demo: false,
    });
    const plan = snapshot.plans[0]!;
    const envelope = {
      requestId,
      status: "ok",
      data: {
        planId: plan.id,
        clientId: plan.clientId,
        recordKey: "c9999999-0000-4000-8000-000000000099",
        version: plan.version,
        rowVersion: plan.rowVersion + 1,
        workflowState: "approved",
        effectiveFrom: plan.effectiveFrom,
        approvedAt: "2026-09-01T02:00:00.000Z",
        replacementEffectiveAt: null,
        replayed: false,
        persisted: true,
        demo: false,
      },
      errors: [],
    };
    expect(() =>
      parseMedicationPlanActionSuccess(envelope, {
        kind: "approve",
        clientId: client.id,
        plan,
      }),
    ).toThrow("INVALID_MEDICATION_PLAN_ACTION_RESPONSE");
  });

  it("requires replacement timing to exactly match whether an approved plan has a predecessor", () => {
    const initial = projectMedicationPlanSnapshot({
      rows: [
        activeRow({
          workflow_state: "submitted",
          lifecycle_state: "submitted",
          effective_from: "2026-10-01T08:00:00+08:00",
          approved_at: null,
          row_version: 2,
        }),
      ],
      clients: [client],
      selectedClient: client,
      generatedAt: "2026-09-01T10:00:00+08:00",
      demo: false,
    }).plans[0]!;
    const initialEnvelope = {
      requestId,
      status: "ok",
      data: {
        planId: initial.id,
        clientId: initial.clientId,
        recordKey: initial.recordKey,
        version: initial.version,
        rowVersion: 3,
        workflowState: "approved",
        effectiveFrom: initial.effectiveFrom,
        approvedAt: "2026-09-02T02:00:00.000Z",
        replacementEffectiveAt: initial.effectiveFrom,
        replayed: false,
        persisted: true,
        demo: false,
      },
      errors: [],
    };
    expect(() =>
      parseMedicationPlanActionSuccess(initialEnvelope, {
        kind: "approve",
        clientId: client.id,
        plan: initial,
      }),
    ).toThrow("INVALID_MEDICATION_PLAN_ACTION_RESPONSE");

    const revision = projectMedicationPlanSnapshot({
      rows: [
        activeRow(),
        activeRow({
          plan_id: "b1000000-0000-4000-8000-000000000002",
          version: 2,
          previous_version_id: "b1000000-0000-4000-8000-000000000001",
          workflow_state: "submitted",
          lifecycle_state: "submitted",
          effective_from: "2026-10-01T08:00:00+08:00",
          approved_at: null,
          row_version: 2,
        }),
      ],
      clients: [client],
      selectedClient: client,
      generatedAt: "2026-09-01T10:00:00+08:00",
      demo: false,
    }).plans.find((plan) => plan.version === 2)!;
    const revisionEnvelope = {
      requestId,
      status: "ok",
      data: {
        planId: revision.id,
        clientId: revision.clientId,
        recordKey: revision.recordKey,
        version: revision.version,
        rowVersion: 3,
        workflowState: "approved",
        effectiveFrom: revision.effectiveFrom,
        approvedAt: "2026-09-02T02:00:00.000Z",
        replacementEffectiveAt: null,
        replayed: false,
        persisted: true,
        demo: false,
      },
      errors: [],
    };
    expect(() =>
      parseMedicationPlanActionSuccess(revisionEnvelope, {
        kind: "approve",
        clientId: client.id,
        plan: revision,
      }),
    ).toThrow("INVALID_MEDICATION_PLAN_ACTION_RESPONSE");
  });

  it("rejects approval before submission and stop before approval", () => {
    const submitted = projectMedicationPlanSnapshot({
      rows: [
        activeRow({
          workflow_state: "submitted",
          lifecycle_state: "submitted",
          effective_from: "2026-10-01T08:00:00+08:00",
          submitted_at: "2026-09-03T02:00:00.000Z",
          approved_at: null,
          row_version: 2,
        }),
      ],
      clients: [client],
      selectedClient: client,
      generatedAt: "2026-09-04T10:00:00+08:00",
      demo: false,
    }).plans[0]!;
    expect(() =>
      parseMedicationPlanActionSuccess(
        {
          requestId,
          status: "ok",
          data: {
            planId: submitted.id,
            clientId: submitted.clientId,
            recordKey: submitted.recordKey,
            version: submitted.version,
            rowVersion: 3,
            workflowState: "approved",
            effectiveFrom: submitted.effectiveFrom,
            approvedAt: "2026-09-02T02:00:00.000Z",
            replacementEffectiveAt: null,
            replayed: false,
            persisted: true,
            demo: false,
          },
          errors: [],
        },
        { kind: "approve", clientId: client.id, plan: submitted },
      ),
    ).toThrow("INVALID_MEDICATION_PLAN_ACTION_RESPONSE");

    const approved = projectMedicationPlanSnapshot({
      rows: [activeRow()],
      clients: [client],
      selectedClient: client,
      generatedAt: "2026-09-01T10:00:00+08:00",
      demo: false,
    }).plans[0]!;
    expect(() =>
      parseMedicationPlanActionSuccess(
        {
          requestId,
          status: "ok",
          data: {
            planId: approved.id,
            clientId: approved.clientId,
            recordKey: approved.recordKey,
            version: approved.version,
            rowVersion: approved.rowVersion,
            lifecycleState: "stopped",
            stoppedAt: "2025-01-01T00:00:00.000Z",
            replayed: false,
            persisted: true,
            demo: false,
          },
          errors: [],
        },
        { kind: "stop", clientId: client.id, plan: approved },
      ),
    ).toThrow("INVALID_MEDICATION_PLAN_ACTION_RESPONSE");
  });
});
