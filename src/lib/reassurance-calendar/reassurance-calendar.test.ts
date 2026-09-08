import { describe, expect, it } from "vitest";

import { buildDemoReassuranceCalendarSnapshot } from "./demo";
import {
  correlateReassuranceCalendarReceipt,
  parseReassuranceCalendarDatabaseReceipt,
  parseReassuranceCalendarMutation,
} from "./parser";
import { projectReassuranceCalendarSnapshot } from "./projection";
import type { ReassuranceCalendarFilters } from "./types";

const organizationId = "44000000-0000-4000-8000-000000000010";
const branchId = "44000000-0000-4000-8000-000000000011";
const key = "44000000-0000-4000-8000-000000000012";
const filters: ReassuranceCalendarFilters = {
  month: "2026-09", organizationId, category: null,
  status: "all", todayOnly: false, query: "",
};

describe("Page 44 reassurance calendar contracts", () => {
  it("derives month calendar and list from the exact same event set", () => {
    const snapshot = buildDemoReassuranceCalendarSnapshot({ organizationId, branchId, filters });
    const calendarKeys = new Set(snapshot.calendarDays.flatMap((day) =>
      day.events.map((event) => event.eventKey)));
    expect(calendarKeys).toEqual(new Set(snapshot.items.map((event) => event.eventKey)));
    expect(snapshot.items).toHaveLength(4);
    expect(snapshot.metrics.cancelled).toBe(1);
    expect(snapshot.items.find((event) => event.status === "cancelled")?.cancellationReason)
      .toContain("保留取消歷程");
    expect(snapshot.notificationStatus).toBe("not_configured");
    expect(snapshot.notificationDelivery).toBe("none_not_sent");
  });

  it("filters the synthetic snapshot without creating writable demo authority", () => {
    const snapshot = buildDemoReassuranceCalendarSnapshot({
      organizationId, branchId,
      filters: { ...filters, category: "transport", status: "scheduled", query: "接送" },
    });
    expect(snapshot.items.map((event) => event.category)).toEqual(["transport"]);
    expect(snapshot.canManage).toBe(false);
    expect(snapshot.canCancel).toBe(false);
    expect(snapshot.demo).toBe(true);
  });

  it("strictly parses create, revision and cancellation inputs", () => {
    const create = parseReassuranceCalendarMutation({
      action: "create", category: "care", title: "合成行程",
      summary: "這是合成測試摘要。", startsAt: "2026-09-10T09:00:00+08:00",
      endsAt: "2026-09-10T10:00:00+08:00", location: "合成活動室",
      audienceKind: "all_branch_clients", targetClientIds: [],
      responsibleUserId: organizationId,
    }, key);
    expect(create.startsAt).toBe("2026-09-10T01:00:00.000Z");
    expect(create.targetClientIds).toEqual([]);
    expect(() => parseReassuranceCalendarMutation({
      action: "create", category: "care", title: "合成行程",
      summary: "摘要", startsAt: "2026-09-10T10:00:00+08:00",
      endsAt: "2026-09-10T09:00:00+08:00", location: "合成活動室",
      audienceKind: "selected_clients", targetClientIds: [],
      responsibleUserId: organizationId, unexpected: true,
    }, key)).toThrow();
    expect(() => parseReassuranceCalendarMutation({
      action: "cancel", eventKey: organizationId,
      previousVersionId: branchId, expectedVersion: 1, reason: "",
    }, key)).toThrow();
  });

  it("rejects an uncorrelated database receipt", () => {
    const input = parseReassuranceCalendarMutation({
      action: "create", category: "care", title: "合成行程", summary: "合成摘要",
      startsAt: "2026-09-10T09:00:00+08:00", endsAt: "2026-09-10T10:00:00+08:00",
      location: "合成活動室", audienceKind: "all_branch_clients",
      targetClientIds: [], responsibleUserId: organizationId,
    }, key);
    const receipt = parseReassuranceCalendarDatabaseReceipt({
      operation_id: key, operation_kind: "create", event_key: organizationId,
      version_id: branchId, event_version: 2, previous_version_id: key,
      record_kind: "revision", event_status: "scheduled", event_category: "care",
      audience_count: 1, publication_state: "published",
      signature_status: "not_configured", notification_status: "not_configured",
      notification_delivery: "none_not_sent", committed_at: "2026-09-01T00:00:00Z",
      replayed: false,
    });
    expect(() => correlateReassuranceCalendarReceipt(receipt, input)).toThrow();
  });

  it("fails closed when projection context or snapshot token is forged", () => {
    const snapshot = buildDemoReassuranceCalendarSnapshot({ organizationId, branchId, filters });
    const row = {
      organization_id: snapshot.organizationId,
      organization_name: snapshot.organizationName,
      branch_id: snapshot.branchId,
      branch_name: snapshot.branchName,
      generated_at: snapshot.generatedAt,
      snapshot_token: "not-a-hash",
      month_start: snapshot.monthStart,
      items: [], matching_total: 0, scheduled_total: 0, cancelled_total: 0,
      today_total: 0, upcoming_total: 0, items_truncated: false,
      category_options: [], staff_options: [], client_options: [],
      can_manage: false, can_cancel: false,
      publication_boundary: "published_versions_only",
      signature_status: "not_configured", notification_status: "not_configured",
      notification_delivery: "none_not_sent",
    };
    expect(() => projectReassuranceCalendarSnapshot({
      row, expectedOrganizationId: organizationId, expectedBranchId: branchId,
      expectedMonth: filters.month, expectedCanManage: false,
      expectedCanCancel: false, demo: false,
    })).toThrow("INVALID_REASSURANCE_CALENDAR_PROJECTION");
  });
});
