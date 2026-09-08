import {
  projectMedicationAdministrationSnapshot,
  type MedicationAdministrationSourceRow,
} from "./projection";

const people = [
  ["a1111111-1111-4111-8111-111111111111", "HX-021", "陳O華"],
  ["a2222222-2222-4222-8222-222222222222", "HX-022", "林O英"],
  ["a3333333-3333-4333-8333-333333333333", "HX-023", "黃O生"],
  ["a4444444-4444-4444-8444-444444444444", "HX-024", "吳O美"],
] as const;

const executor = {
  id: "e1111111-1111-4111-8111-111111111111",
  name: "王護理師",
};
const verifier = {
  id: "e2222222-2222-4222-8222-222222222222",
  name: "李護理師",
};

function baseRow(
  serviceDate: string,
  index: number,
  time: string,
  medicationName: string,
  dose: number,
  unit: string,
): MedicationAdministrationSourceRow {
  const person = people[index % people.length]!;
  return {
    administration_id: `b${index + 1}111111-1111-4111-8111-111111111111`,
    client_id: person[0],
    client_code: person[1],
    client_display_name: person[2],
    medication_plan_id: `c${index + 1}111111-1111-4111-8111-111111111111`,
    medication_name: medicationName,
    planned_dose: dose,
    dose_unit: unit,
    medication_route: "口服",
    high_risk: false,
    scheduled_for: `${serviceDate}T${time}:00+08:00`,
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
}

export function buildDemoMedicationAdministrationSnapshot(serviceDate: string) {
  const normal = {
    ...baseRow(serviceDate, 0, "08:00", "血壓用藥（展示）", 1, "錠"),
    occurred_at: `${serviceDate}T08:04:00+08:00`,
    execution_signed_at: `${serviceDate}T08:04:30+08:00`,
    status: "administered",
    actual_dose: 1,
    actual_dose_unit: "錠",
    execution_source: "staff",
    recorded_by: executor.id,
    recorded_by_name: executor.name,
    signed_at: `${serviceDate}T08:04:30+08:00`,
    finalization_state: "signed",
  } satisfies MedicationAdministrationSourceRow;
  const highRiskPending = {
    ...baseRow(serviceDate, 1, "09:00", "高風險用藥（展示）", 0.5, "錠"),
    high_risk: true,
    occurred_at: `${serviceDate}T09:03:00+08:00`,
    execution_signed_at: `${serviceDate}T09:03:30+08:00`,
    status: "administered",
    actual_dose: 0.5,
    actual_dose_unit: "錠",
    execution_source: "staff",
    requires_second_verification: true,
    recorded_by: executor.id,
    recorded_by_name: executor.name,
    finalization_state: "pending_verification",
  } satisfies MedicationAdministrationSourceRow;
  const refused = {
    ...baseRow(serviceDate, 2, "09:30", "胃部用藥（展示）", 10, "mL"),
    occurred_at: `${serviceDate}T09:34:00+08:00`,
    execution_signed_at: `${serviceDate}T09:35:00+08:00`,
    status: "refused",
    reason: "個案明確拒絕，已依機構流程通知護理人員。",
    execution_source: "staff",
    recorded_by: executor.id,
    recorded_by_name: executor.name,
    signed_at: `${serviceDate}T09:35:00+08:00`,
    finalization_state: "signed",
  } satisfies MedicationAdministrationSourceRow;
  const verified = {
    ...baseRow(serviceDate, 3, "10:00", "高風險用藥（展示）", 2, "mg"),
    high_risk: true,
    occurred_at: `${serviceDate}T10:02:00+08:00`,
    execution_signed_at: `${serviceDate}T10:02:30+08:00`,
    status: "administered",
    actual_dose: 2,
    actual_dose_unit: "mg",
    execution_source: "staff",
    requires_second_verification: true,
    recorded_by: executor.id,
    recorded_by_name: executor.name,
    second_verified_by: verifier.id,
    second_verified_by_name: verifier.name,
    second_verified_at: `${serviceDate}T10:04:00+08:00`,
    signed_at: `${serviceDate}T10:04:00+08:00`,
    finalization_state: "signed",
  } satisfies MedicationAdministrationSourceRow;
  const held = {
    ...baseRow(serviceDate, 4, "11:00", "餐後用藥（展示）", 1, "包"),
    occurred_at: `${serviceDate}T11:06:00+08:00`,
    execution_signed_at: `${serviceDate}T11:07:00+08:00`,
    status: "held",
    reason: "依現場已核准流程暫停，等待授權人員後續處置。",
    execution_source: "staff",
    recorded_by: executor.id,
    recorded_by_name: executor.name,
    signed_at: `${serviceDate}T11:07:00+08:00`,
    finalization_state: "signed",
  } satisfies MedicationAdministrationSourceRow;
  const scheduled = baseRow(
    serviceDate,
    5,
    "15:30",
    "下午用藥（展示）",
    1,
    "錠",
  );

  return projectMedicationAdministrationSnapshot({
    serviceDate,
    generatedAt: `${serviceDate}T15:10:00+08:00`,
    rows: [normal, highRiskPending, refused, verified, held, scheduled],
    demo: true,
  });
}
