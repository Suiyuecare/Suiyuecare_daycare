import {
  projectMedicationPlanSnapshot,
  type MedicationPlanSourceRow,
} from "./projection";
import type { MedicationPlanClientOption } from "./types";

const clients: readonly MedicationPlanClientOption[] = [
  {
    id: "a1111111-1111-4111-8111-111111111111",
    code: "HX-021",
    displayName: "陳O華",
    status: "active",
    admittedOn: "2025-04-01",
    endedOn: null,
    canCreatePlan: true,
  },
  {
    id: "a2222222-2222-4222-8222-222222222222",
    code: "LOCAL-022",
    displayName: "林O英",
    status: "active",
    admittedOn: "2025-07-18",
    endedOn: null,
    canCreatePlan: true,
  },
];

function shift(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1_000).toISOString();
}

function row(
  input: Omit<
    MedicationPlanSourceRow,
    | "record_key"
    | "client_id"
    | "dose_unit"
    | "medication_route"
    | "schedule"
    | "high_risk"
    | "effective_to"
    | "submitted_at"
    | "submitted_by_current_actor"
    | "approved_at"
    | "terminated_at"
    | "termination_kind"
    | "termination_reason"
    | "replacement_plan_id"
    | "row_version"
  > &
    Partial<MedicationPlanSourceRow> & { record_key: string },
): MedicationPlanSourceRow {
  return {
    client_id: clients[0]!.id,
    dose_unit: "mg",
    medication_route: "口服",
    schedule: { times: ["08:00", "20:00"] },
    high_risk: false,
    effective_to: null,
    submitted_at: null,
    submitted_by_current_actor: false,
    approved_at: null,
    terminated_at: null,
    termination_kind: null,
    termination_reason: null,
    replacement_plan_id: null,
    row_version: input.workflow_state === "approved" ? 3 : input.workflow_state === "submitted" ? 2 : 1,
    ...input,
  };
}

export function buildDemoMedicationPlanSnapshot(
  requestedClientId?: string,
  generatedAt = new Date(),
) {
  const selectedClient = requestedClientId
    ? clients.find((client) => client.id === requestedClientId)
    : clients[0];
  if (!selectedClient) throw new Error("DEMO_CLIENT_OUT_OF_SCOPE");

  const rows: MedicationPlanSourceRow[] =
    selectedClient.id === clients[0]!.id
      ? [
          row({
            plan_id: "b1000000-0000-4000-8000-000000000001",
            record_key: "c1000000-0000-4000-8000-000000000001",
            version: 1,
            previous_version_id: null,
            medication_name: "Metformin",
            dose: 500,
            effective_from: shift(generatedAt, -180),
            workflow_state: "approved",
            lifecycle_state: "replaced",
            submitted_at: shift(generatedAt, -182),
            approved_at: shift(generatedAt, -181),
            terminated_at: shift(generatedAt, -30),
            termination_kind: "replaced",
            termination_reason: "依新版用藥計畫於排定時間換藥",
            replacement_plan_id: "b1000000-0000-4000-8000-000000000002",
          }),
          row({
            plan_id: "b1000000-0000-4000-8000-000000000002",
            record_key: "c1000000-0000-4000-8000-000000000001",
            version: 2,
            previous_version_id: "b1000000-0000-4000-8000-000000000001",
            medication_name: "Metformin XR",
            dose: 750,
            effective_from: shift(generatedAt, -30),
            workflow_state: "approved",
            lifecycle_state: "active",
            submitted_at: shift(generatedAt, -32),
            approved_at: shift(generatedAt, -31),
          }),
          row({
            plan_id: "b2000000-0000-4000-8000-000000000001",
            record_key: "c2000000-0000-4000-8000-000000000001",
            version: 1,
            previous_version_id: null,
            medication_name: "Vitamin D",
            dose: 1,
            dose_unit: "顆",
            schedule: { times: ["09:00"] },
            effective_from: shift(generatedAt, 3),
            workflow_state: "draft",
            lifecycle_state: "draft",
          }),
          row({
            plan_id: "b3000000-0000-4000-8000-000000000001",
            record_key: "c3000000-0000-4000-8000-000000000001",
            version: 1,
            previous_version_id: null,
            medication_name: "Clopidogrel",
            dose: 75,
            schedule: { times: ["08:30"] },
            high_risk: true,
            effective_from: shift(generatedAt, 2),
            workflow_state: "submitted",
            lifecycle_state: "submitted",
            submitted_at: shift(generatedAt, -1),
            submitted_by_current_actor: true,
          }),
          row({
            plan_id: "b4000000-0000-4000-8000-000000000001",
            record_key: "c4000000-0000-4000-8000-000000000001",
            version: 1,
            previous_version_id: null,
            medication_name: "Calcium",
            dose: 600,
            schedule: { times: ["12:00"] },
            effective_from: shift(generatedAt, 7),
            effective_to: shift(generatedAt, 28),
            workflow_state: "approved",
            lifecycle_state: "scheduled",
            submitted_at: shift(generatedAt, -3),
            approved_at: shift(generatedAt, -2),
          }),
          row({
            plan_id: "b5000000-0000-4000-8000-000000000001",
            record_key: "c5000000-0000-4000-8000-000000000001",
            version: 1,
            previous_version_id: null,
            medication_name: "Iron",
            dose: 1,
            dose_unit: "顆",
            schedule: { times: ["10:00"] },
            effective_from: shift(generatedAt, -120),
            effective_to: shift(generatedAt, -60),
            workflow_state: "approved",
            lifecycle_state: "expired",
            submitted_at: shift(generatedAt, -123),
            approved_at: shift(generatedAt, -122),
          }),
          row({
            plan_id: "b6000000-0000-4000-8000-000000000001",
            record_key: "c6000000-0000-4000-8000-000000000001",
            version: 1,
            previous_version_id: null,
            medication_name: "Aspirin",
            dose: 100,
            schedule: { times: ["18:00"] },
            effective_from: shift(generatedAt, -90),
            workflow_state: "approved",
            lifecycle_state: "stopped",
            submitted_at: shift(generatedAt, -93),
            approved_at: shift(generatedAt, -92),
            terminated_at: shift(generatedAt, -3),
            termination_kind: "stopped",
            termination_reason: "依最新用藥指示停止此計畫",
          }),
        ]
      : [];

  return projectMedicationPlanSnapshot({
    rows,
    clients,
    selectedClient,
    generatedAt: generatedAt.toISOString(),
    demo: true,
  });
}
