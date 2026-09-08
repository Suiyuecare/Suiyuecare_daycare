import { describe, expect, it } from "vitest";

import { buildDemoMealManagementSnapshot } from "./demo";
import { mealMutationPayload, parseMealMutation, parseMealMutationReceipt } from "./parser";
import { projectMealManagementSnapshot } from "./projection";
import { parseMealManagementFilters } from "./query";

const KEY = "57000000-0000-4000-8000-000000000001";
const CLIENT = "57000000-0000-4000-8000-000000000002";
const PLAN = "57000000-0000-4000-8000-000000000003";

describe("Page-57 meal-management contracts", () => {
  it("parses only known single-value filters", () => {
    expect(parseMealManagementFilters(new URLSearchParams(
      "date=2026-09-02&meal=lunch&texture=%E8%BB%9F%E8%B3%AA&conflict=with_conflicts",
    ), "2026-09-01")).toEqual({ serviceDate: "2026-09-02", mealKind: "lunch",
      textureQuery: "軟質", conflict: "with_conflicts" });
    expect(() => parseMealManagementFilters(
      new URLSearchParams("meal=lunch&meal=dinner"), "2026-09-02",
    )).toThrow("餐食篩選條件不得重複");
    expect(() => parseMealManagementFilters(
      new URLSearchParams("unknown=x"), "2026-09-02",
    )).toThrow("餐食篩選包含未知欄位");
  });

  it("keeps missing, not-applicable, unknown, and none-declared distinct", () => {
    const parsed = parseMealMutation({ action: "set_requirement", client_id: CLIENT,
      previous_version_id: null, expected_version: 0, effective_from: "2026-09-02",
      texture_state: "missing", texture_label: null,
      allergy_status: "none_declared", allergens: [],
      contraindication_status: "unknown", contraindications: [], note: null }, KEY);
    expect(parsed).toMatchObject({ textureState: "missing",
      allergyStatus: "none_declared", contraindicationStatus: "unknown" });
  });

  it("requires recorded labels and exact structured reference codes", () => {
    const base = { action: "set_requirement", client_id: CLIENT,
      previous_version_id: null, expected_version: 0, effective_from: "2026-09-02",
      texture_state: "recorded", texture_label: null,
      allergy_status: "recorded", allergens: [{ code: "egg", label: "蛋" }],
      contraindication_status: "none_declared", contraindications: [], note: null };
    expect(() => parseMealMutation(base, KEY)).toThrow("狀態與內容不一致");
    expect(() => parseMealMutation({ ...base, texture_label: "細碎",
      allergens: [{ code: "EGG", label: "蛋" }] }, KEY)).toThrow();
  });

  it("rejects duplicate ingredient and completion identities", () => {
    expect(() => parseMealMutation({ action: "save_plan", previous_version_id: null,
      expected_version: 0, service_date: "2026-09-02", meal_kind: "lunch",
      menu_title: "合成午餐", ingredients: [
        { code: "egg", label: "蛋" }, { code: "egg", label: "蛋製品" },
      ], extra_portions: 0 }, KEY)).toThrow();
    expect(() => parseMealMutation({ action: "complete_plan", plan_version_id: PLAN,
      expected_version: 1, resolutions: [], actual_portions: [
        { client_id: CLIENT, portions: 1 }, { client_id: CLIENT, portions: 0 },
      ], extra_actual_portions: 0, variance_reason: null }, KEY)).toThrow("不得重複");
  });

  it("uses an exact DB payload without actor or tenant fields", () => {
    const input = parseMealMutation({ action: "save_plan", previous_version_id: null,
      expected_version: 0, service_date: "2026-09-02", meal_kind: "lunch",
      menu_title: "合成午餐", ingredients: [{ code: "rice", label: "飯" }],
      extra_portions: 2 }, KEY);
    expect(mealMutationPayload(input)).toEqual({ previous_version_id: null,
      expected_version: 0, service_date: "2026-09-02", meal_kind: "lunch",
      menu_title: "合成午餐", ingredients: [{ code: "rice", label: "飯" }],
      extra_portions: 2 });
  });

  it("correlates a strict immutable receipt", () => {
    const input = parseMealMutation({ action: "save_plan", previous_version_id: null,
      expected_version: 0, service_date: "2026-09-02", meal_kind: "lunch",
      menu_title: "合成午餐", ingredients: [{ code: "rice", label: "飯" }],
      extra_portions: 0 }, KEY);
    expect(parseMealMutationReceipt({ operation_id: KEY, action: "save_plan",
      entity_type: "plan", entity_id: PLAN,
      stable_key: "57000000-0000-4000-8000-000000000004", version: 1,
      status: "review", client_id: null, service_date: "2026-09-02",
      meal_kind: "lunch", attendance_count: 2, conflict_count: 1,
      planned_portion_total: 2, actual_portion_total: null,
      committed_at: "2026-09-02T08:00:00Z", replayed: false }, input))
      .toMatchObject({ version: 1, conflictCount: 1, persisted: true });
  });

  it("rejects stale or cross-action receipts", () => {
    const input = parseMealMutation({ action: "complete_plan", plan_version_id: PLAN,
      expected_version: 1, resolutions: [], actual_portions: [],
      extra_actual_portions: 0, variance_reason: null }, KEY);
    expect(() => parseMealMutationReceipt({ operation_id: KEY, action: "save_plan",
      entity_type: "plan", entity_id: PLAN, stable_key: KEY, version: 2,
      status: "prepared", client_id: null, service_date: "2026-09-02",
      meal_kind: "lunch", attendance_count: 0, conflict_count: 0,
      planned_portion_total: 0, actual_portion_total: 0,
      committed_at: "2026-09-02T08:00:00Z", replayed: false }, input)).toThrow(
        "餐食操作回執與送出內容不一致",
      );
  });

  it("projects one internally reconciled synthetic snapshot", () => {
    const snapshot = buildDemoMealManagementSnapshot({
      serviceDate: "2026-09-02", mealKind: "all", textureQuery: "", conflict: "all",
    });
    expect(snapshot).toMatchObject({ demo: true, clientTotal: 3,
      matchingPlanTotal: 2, expectedPortionTotal: 4,
      actualPortionTotal: 2, specialTextureTotal: null, conflictTotal: 5,
      textureTaxonomyStatus: "manual_unstandardized",
      offlineStatus: "not_configured", exportStatus: "not_configured" });
    expect(new Date(snapshot.staleAfter).getTime() -
      new Date(snapshot.generatedAt).getTime()).toBe(60_000);
  });

  it("keeps a resolved prepared plan distinct from a pending review", () => {
    const snapshot = buildDemoMealManagementSnapshot({
      serviceDate: "2026-09-02", mealKind: "all", textureQuery: "", conflict: "all",
    });
    const prepared = snapshot.plans.find(({ status }) => status === "prepared")!;
    const review = snapshot.plans.find(({ status }) => status === "review")!;
    expect(prepared.assignments.map(({ resolutionStatus }) => resolutionStatus))
      .toEqual(["resolved", "resolved"]);
    expect(prepared).toMatchObject({ attendanceCount: 2,
      extraPlannedPortions: 1, plannedPortionTotal: 3,
      extraActualPortions: 0, actualPortionTotal: 2 });
    expect(review.assignments[0]).toMatchObject({ requirementVersionId: null,
      textureState: null, allergyStatus: null,
      contraindicationStatus: null, resolutionStatus: "pending" });
  });

  it("applies meal, texture, and conflict filters to the same totals", () => {
    const lunch = buildDemoMealManagementSnapshot({
      serviceDate: "2026-09-02", mealKind: "lunch",
      textureQuery: "軟", conflict: "with_conflicts",
    });
    expect(lunch.plans).toHaveLength(1);
    expect(lunch).toMatchObject({ matchingPlanTotal: 1,
      expectedPortionTotal: 3, actualPortionTotal: 2, conflictTotal: 4 });
    const clear = buildDemoMealManagementSnapshot({
      serviceDate: "2026-09-02", mealKind: "all", textureQuery: "", conflict: "clear",
    });
    expect(clear.plans).toEqual([]);
    expect(clear).toMatchObject({ matchingPlanTotal: 0,
      expectedPortionTotal: 0, actualPortionTotal: 0, conflictTotal: 0 });
  });

  it("fails closed for an untrusted or cross-tenant snapshot shape", () => {
    expect(() => projectMealManagementSnapshot({ row: {},
      expectedOrganizationId: KEY, expectedBranchId: CLIENT,
      filters: { serviceDate: "2026-09-02", mealKind: "all",
        textureQuery: "", conflict: "all" }, demo: false })).toThrow(
        "INVALID_MEAL_MANAGEMENT_SNAPSHOT",
      );
    expect(() => projectMealManagementSnapshot({
      row: { organization_id: KEY, branch_id: CLIENT },
      expectedOrganizationId: PLAN, expectedBranchId: CLIENT,
      filters: { serviceDate: "2026-09-02", mealKind: "all",
        textureQuery: "", conflict: "all" }, demo: false,
    })).toThrow("INVALID_MEAL_MANAGEMENT_SNAPSHOT");
  });

  it("rejects unknown body fields and impossible calendar dates", () => {
    const base = { action: "save_plan", previous_version_id: null,
      expected_version: 0, service_date: "2026-09-02", meal_kind: "lunch",
      menu_title: "合成午餐", ingredients: [{ code: "rice", label: "飯" }],
      extra_portions: 0 };
    expect(() => parseMealMutation({ ...base, actor_id: CLIENT }, KEY)).toThrow();
    expect(() => parseMealMutation({ ...base, service_date: "2026-02-30" }, KEY)).toThrow();
  });
});
