import { describe, expect, it } from "vitest";

import { buildDemoClientMasterSnapshot } from "@/lib/clients/master-demo";

import { isPlanMonth, planMonthLastDate, taipeiPlanMonth } from "./date";
import {
  canPlanClientForMonth,
  filterIndividualServicePlanSnapshot,
  projectIndividualServicePlanSnapshot,
} from "./projection";

const clientId = "a1111111-1111-4111-8111-111111111111";
const responsibleId = "d1111111-1111-4111-8111-111111111111";

function project(overrides: Record<string, unknown> = {}) {
  const master = buildDemoClientMasterSnapshot();
  return projectIndividualServicePlanSnapshot({
    clients: master.clients,
    planMonth: "2026-09",
    generatedAt: "2026-09-01T02:00:00.000Z",
    demo: false,
    responsibleRows: [{ user_id: responsibleId, display_name: "王社工" }],
    planRows: [{
      plan_id: "e1111111-1111-4111-8111-111111111111",
      client_id: clientId,
      plan_month: "2026-09-01",
      plan_version: 1,
      previous_plan_id: null,
      correction_reason: null,
      signed_at: "2026-09-01T01:00:00.000Z",
      plan_items: [{
        item_order: 1,
        goal: "維持活動",
        activity: "團體活動",
        frequency: "每週二次",
        responsible_user_id: responsibleId,
        responsible_display_name: "王社工",
        progress_status: "in_progress",
        progress_note: "已開始",
      }],
      ...overrides,
    }],
  });
}

describe("individual service plan projection", () => {
  it("derives the Taipei month at the UTC month boundary", () => {
    expect(taipeiPlanMonth(new Date("2026-08-31T16:01:00.000Z"))).toBe("2026-09");
    expect(isPlanMonth("2026-02")).toBe(true);
    expect(isPlanMonth("2026-13")).toBe(false);
    expect(planMonthLastDate("2024-02")).toBe("2024-02-29");
  });

  it("treats a service period intersecting the selected month as plan eligible", () => {
    expect(canPlanClientForMonth({ admittedOn: "2026-09-30", endedOn: "2026-09-30" }, "2026-09")).toBe(true);
    expect(canPlanClientForMonth({ admittedOn: "2026-10-01", endedOn: null }, "2026-09")).toBe(false);
    expect(canPlanClientForMonth({ admittedOn: null, endedOn: null }, "2026-09")).toBe(false);
  });

  it("projects only the latest supplied row and counts human-entered progress", () => {
    const snapshot = project();
    expect(snapshot.clients.find((client) => client.clientId === clientId)?.latestPlan?.items[0]).toMatchObject({
      goal: "維持活動",
      responsibleDisplayName: "王社工",
      progressStatus: "in_progress",
    });
    expect(snapshot.counts).toEqual({ plans: 1, notStarted: 0, inProgress: 1, completed: 0 });
  });

  it("fails closed on another month, extra fields or broken item order", () => {
    expect(() => project({ plan_month: "2026-08-01" })).toThrow(/INVALID_INDIVIDUAL/u);
    expect(() => project({ signed_by: responsibleId })).toThrow(/INVALID_INDIVIDUAL/u);
    expect(() => project({ plan_items: [{
      item_order: 2, goal: "目標", activity: "活動", frequency: "每週",
      responsible_user_id: responsibleId, responsible_display_name: "王社工",
      progress_status: "completed", progress_note: null,
    }] })).toThrow(/INVALID_INDIVIDUAL/u);
  });

  it("rejects duplicate client rows instead of guessing a version", () => {
    const master = buildDemoClientMasterSnapshot();
    const row = {
      plan_id: "e1111111-1111-4111-8111-111111111111", client_id: clientId,
      plan_month: "2026-09-01", plan_version: 1, previous_plan_id: null,
      correction_reason: null, signed_at: "2026-09-01T01:00:00.000Z",
      plan_items: [{ item_order: 1, goal: "目標", activity: "活動", frequency: "每週",
        responsible_user_id: responsibleId, responsible_display_name: "王社工",
        progress_status: "not_started", progress_note: null }],
    };
    expect(() => projectIndividualServicePlanSnapshot({ clients: master.clients, planRows: [row, { ...row, plan_id: "e2222222-2222-4222-8222-222222222222" }], responsibleRows: [], planMonth: "2026-09", generatedAt: "2026-09-01T00:00:00Z", demo: false })).toThrow(/INVALID_INDIVIDUAL/u);
  });

  it("filters without changing month or expanding the authorized set", () => {
    const snapshot = project();
    expect(filterIndividualServicePlanSnapshot(snapshot, { query: "HX-021", responsible: responsibleId, progress: "in_progress" }).clients).toHaveLength(1);
    expect(filterIndividualServicePlanSnapshot(snapshot, { query: "不存在", responsible: "all", progress: "all" }).clients).toHaveLength(0);
  });
});
