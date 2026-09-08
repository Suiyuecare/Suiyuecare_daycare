import { projectMealManagementSnapshot } from "./projection";
import type { MealManagementFilters } from "./types";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_A = "57100000-0000-4000-8000-000000000001";
const CLIENT_B = "57100000-0000-4000-8000-000000000002";
const CLIENT_C = "57100000-0000-4000-8000-000000000003";

function conflict(
  keyCharacter: string,
  kind: "requirement_missing" | "texture_missing" | "allergy_unknown" |
    "contraindication_unknown" | "allergen_match",
  clientId: string,
  label: string,
  itemCode: string | null = null,
) {
  return { key: keyCharacter.repeat(64), kind, client_id: clientId,
    item_code: itemCode, label };
}

export function buildDemoMealManagementSnapshot(filters: MealManagementFilters) {
  const generatedAt = new Date().toISOString();
  const allergen = conflict("a", "allergen_match", CLIENT_A, "花生", "peanut");
  const texture = conflict("b", "texture_missing", CLIENT_B, "餐食質地尚未確認");
  const allergyUnknown = conflict("c", "allergy_unknown", CLIENT_B, "過敏資訊尚未確認");
  const contraindicationUnknown = conflict(
    "d", "contraindication_unknown", CLIENT_B, "禁忌資訊尚未確認",
  );
  const requirementMissing = conflict(
    "e", "requirement_missing", CLIENT_C, "尚未設定餐食需求",
  );
  const lunchConflicts = [allergen, texture, allergyUnknown, contraindicationUnknown];
  const candidates = [
    {
      plan_version_id: "57200000-0000-4000-8000-000000000002",
      plan_key: "57210000-0000-4000-8000-000000000001",
      version: 2,
      previous_version_id: "57200000-0000-4000-8000-000000000001",
      status: "prepared" as const,
      service_date: filters.serviceDate,
      meal_kind: "lunch" as const,
      menu_title: "合成示例：替代蛋白午餐",
      ingredients: [{ code: "peanut", label: "花生" }, { code: "rice", label: "米" }],
      attendance_count: 2,
      extra_planned_portions: 1,
      planned_portion_total: 3,
      extra_actual_portions: 0,
      actual_portion_total: 2,
      conflict_count: 4,
      attendance_snapshot_hash: "1".repeat(64),
      variance_reason: null,
      created_by_display_name: "合成餐食主管",
      created_at: generatedAt,
      assignment_snapshot: [
        {
          client_id: CLIENT_A,
          client_code: "SYN-MEAL-001",
          client_display_name: "合成個案甲",
          requirement_version_id: "57300000-0000-4000-8000-000000000001",
          texture_state: "recorded" as const,
          texture_label: "軟質",
          allergy_status: "recorded" as const,
          allergen_labels: ["花生"],
          contraindication_status: "none_declared" as const,
          contraindication_labels: [],
          planned_portions: 1 as const,
          conflicts: [allergen],
        },
        {
          client_id: CLIENT_B,
          client_code: "SYN-MEAL-002",
          client_display_name: "合成個案乙",
          requirement_version_id: "57300000-0000-4000-8000-000000000002",
          texture_state: "missing" as const,
          texture_label: null,
          allergy_status: "unknown" as const,
          allergen_labels: [],
          contraindication_status: "unknown" as const,
          contraindication_labels: [],
          planned_portions: 1 as const,
          conflicts: [texture, allergyUnknown, contraindicationUnknown],
        },
      ],
      conflict_snapshot: lunchConflicts,
      resolution_snapshot: lunchConflicts.map((entry) => ({
        conflict_key: entry.key,
        disposition: "substituted" as const,
        note: "合成示例：已人工確認替代餐，並非自動照顧決策。",
      })),
      actual_portions: [
        { client_id: CLIENT_A, portions: 1 },
        { client_id: CLIENT_B, portions: 1 },
      ],
    },
    {
      plan_version_id: "57200000-0000-4000-8000-000000000003",
      plan_key: "57210000-0000-4000-8000-000000000002",
      version: 1,
      previous_version_id: null,
      status: "review" as const,
      service_date: filters.serviceDate,
      meal_kind: "afternoon_snack" as const,
      menu_title: "合成示例：午後點心",
      ingredients: [{ code: "soy", label: "黃豆" }],
      attendance_count: 1,
      extra_planned_portions: 0,
      planned_portion_total: 1,
      extra_actual_portions: null,
      actual_portion_total: null,
      conflict_count: 1,
      attendance_snapshot_hash: "2".repeat(64),
      variance_reason: null,
      created_by_display_name: "合成餐食主管",
      created_at: generatedAt,
      assignment_snapshot: [{
        client_id: CLIENT_C,
        client_code: "SYN-MEAL-003",
        client_display_name: "合成個案丙",
        requirement_version_id: null,
        texture_state: null,
        texture_label: null,
        allergy_status: null,
        allergen_labels: [],
        contraindication_status: null,
        contraindication_labels: [],
        planned_portions: 1 as const,
        conflicts: [requirementMissing],
      }],
      conflict_snapshot: [requirementMissing],
      resolution_snapshot: null,
      actual_portions: null,
    },
  ];
  const normalizedTexture = filters.textureQuery.toLocaleLowerCase("zh-TW");
  const plans = candidates.filter((plan) =>
    (filters.mealKind === "all" || plan.meal_kind === filters.mealKind) &&
    (!normalizedTexture || plan.assignment_snapshot.some((assignment) =>
      (assignment.texture_label ?? "").toLocaleLowerCase("zh-TW")
        .includes(normalizedTexture))) &&
    (filters.conflict === "all" ||
      (filters.conflict === "with_conflicts" && plan.conflict_count > 0) ||
      (filters.conflict === "clear" && plan.conflict_count === 0)),
  );
  return projectMealManagementSnapshot({
    expectedOrganizationId: ORGANIZATION_ID,
    expectedBranchId: BRANCH_ID,
    filters,
    demo: true,
    row: {
      organization_id: ORGANIZATION_ID,
      branch_id: BRANCH_ID,
      generated_at: generatedAt,
      clients: [
        { client_id: CLIENT_A, client_code: "SYN-MEAL-001",
          display_name: "合成個案甲", requirement_version_id: "57300000-0000-4000-8000-000000000001",
          requirement_version: 1, effective_from: filters.serviceDate,
          texture_state: "recorded", texture_label: "軟質",
          allergy_status: "recorded", allergens: [{ code: "peanut", label: "花生" }],
          contraindication_status: "none_declared", contraindications: [] },
        { client_id: CLIENT_B, client_code: "SYN-MEAL-002",
          display_name: "合成個案乙", requirement_version_id: "57300000-0000-4000-8000-000000000002",
          requirement_version: 1, effective_from: filters.serviceDate,
          texture_state: "missing", texture_label: null,
          allergy_status: "unknown", allergens: [], contraindication_status: "unknown",
          contraindications: [] },
        { client_id: CLIENT_C, client_code: "SYN-MEAL-003",
          display_name: "合成個案丙", requirement_version_id: null,
          requirement_version: null, effective_from: null, texture_state: null,
          texture_label: null, allergy_status: null, allergens: [],
          contraindication_status: null, contraindications: [] },
      ],
      client_total: 3,
      clients_truncated: false,
      plans,
      matching_plan_total: plans.length,
      plans_truncated: false,
      expected_portion_total: plans.reduce(
        (total, plan) => total + plan.planned_portion_total, 0),
      actual_portion_total: plans.reduce(
        (total, plan) => total + (plan.actual_portion_total ?? 0), 0),
      special_texture_total: null,
      conflict_total: plans.reduce((total, plan) => total + plan.conflict_count, 0),
      attendance_reconciliation_status: "available",
      texture_taxonomy_status: "manual_unstandardized",
      offline_status: "not_configured",
      export_status: "not_configured",
    },
  });
}
