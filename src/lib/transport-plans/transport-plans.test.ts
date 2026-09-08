import { describe, expect, it } from "vitest";

import { buildDemoTransportPlanSnapshot } from "./demo";
import {
  parseTransportPlanMutation,
  parseTransportPlanReceipt,
  transportPlanMutationPayload,
} from "./parser";
import { projectTransportPlanSnapshot } from "./projection";
import { parseTransportPlanFilters } from "./query";

const KEY = "47900000-0000-4000-8000-000000000001";
const TRIP = "47900000-0000-4000-8000-000000000002";
const TRIP_KEY = "47900000-0000-4000-8000-000000000003";
const DRIVER = "47900000-0000-4000-8000-000000000004";
const CLIENT = "47900000-0000-4000-8000-000000000005";
const RULE = "47900000-0000-4000-8000-000000000006";
const HASH = "a".repeat(64);

function saveBody(overrides: Record<string, unknown> = {}) {
  return { action: "save_trip", mode: "create", trip_key: null,
    previous_version_id: null, expected_version: 0, expected_content_hash: null,
    direction: "pickup", service_date: "2026-09-07",
    starts_at: "2026-09-07T08:00:00+08:00",
    ends_at: "2026-09-07T09:00:00+08:00", vehicle_code: "VAN-A",
    driver_membership_id: DRIVER, pickup_label: "合成集合點",
    dropoff_label: "合成日照中心", passengers: [{ client_id: CLIENT,
      pickup_label: "合成住址", dropoff_label: "合成中心" }],
    revision_reason: "依人工規則建立合成趟次", ...overrides };
}

describe("Page-47 transport planning contracts", () => {
  it("accepts only known single-value filters", () => {
    expect(parseTransportPlanFilters(new URLSearchParams(
      "date=2026-09-07&direction=pickup&vehicle=VAN&driver=P47&status=published",
    ), "2026-09-01")).toEqual({ serviceDate: "2026-09-07", direction: "pickup",
      vehicleQuery: "VAN", driverQuery: "P47", status: "published" });
    expect(() => parseTransportPlanFilters(
      new URLSearchParams("direction=pickup&direction=dropoff"), "2026-09-07",
    )).toThrow("不得重複");
    expect(() => parseTransportPlanFilters(
      new URLSearchParams("unknown=x"), "2026-09-07",
    )).toThrow("未知欄位");
  });

  it("parses one strict create with unique passengers and normalized timestamps", () => {
    expect(parseTransportPlanMutation(saveBody(), KEY)).toMatchObject({
      action: "save_trip", mode: "create", expectedVersion: 0,
      driverMembershipId: DRIVER, passengers: [{ clientId: CLIENT }],
      startsAt: "2026-09-07T00:00:00.000Z",
    });
  });

  it("rejects duplicate passengers, long trips and unknown fields", () => {
    const passenger = (saveBody().passengers as object[])[0];
    expect(() => parseTransportPlanMutation(saveBody({
      passengers: [passenger, passenger],
    }), KEY)).toThrow("版本、時段或乘員集合不一致");
    expect(() => parseTransportPlanMutation(saveBody({
      ends_at: "2026-09-07T17:00:00+08:00",
    }), KEY)).toThrow();
    expect(() => parseTransportPlanMutation({ ...saveBody(), actor_id: CLIENT }, KEY)).toThrow();
  });

  it("requires a complete prior-version expectation for revisions", () => {
    expect(() => parseTransportPlanMutation(saveBody({ mode: "revise",
      trip_key: TRIP_KEY, previous_version_id: null, expected_version: 1,
      expected_content_hash: HASH }), KEY)).toThrow();
    expect(parseTransportPlanMutation(saveBody({ mode: "revise", trip_key: TRIP_KEY,
      previous_version_id: TRIP, expected_version: 1, expected_content_hash: HASH }), KEY))
      .toMatchObject({ mode: "revise", tripKey: TRIP_KEY, previousVersionId: TRIP });
  });

  it("does not allow ordinary publish to claim a conflicted draft", () => {
    const base = { action: "decide_trip", trip_version_id: TRIP,
      expected_trip_key: TRIP_KEY, expected_version: 1,
      expected_content_hash: HASH, expected_rule_version_id: RULE,
      reason: "獨立核對所有交通資源衝突" };
    expect(() => parseTransportPlanMutation({ ...base, decision: "publish",
      expected_conflict_count: 2 }, KEY)).toThrow("發布方式與衝突數不一致");
    expect(() => parseTransportPlanMutation({ ...base, decision: "override",
      expected_conflict_count: 0 }, KEY)).toThrow("發布方式與衝突數不一致");
  });

  it("sends an exact database payload without actor or tenant fields", () => {
    const input = parseTransportPlanMutation(saveBody(), KEY);
    expect(transportPlanMutationPayload(input)).toEqual({ mode: "create",
      trip_key: null, previous_version_id: null, expected_version: 0,
      expected_content_hash: null, direction: "pickup", service_date: "2026-09-07",
      starts_at: "2026-09-07T00:00:00.000Z", ends_at: "2026-09-07T01:00:00.000Z",
      vehicle_code: "VAN-A", driver_membership_id: DRIVER,
      pickup_label: "合成集合點", dropoff_label: "合成日照中心",
      passengers: [{ client_id: CLIENT, pickup_label: "合成住址",
        dropoff_label: "合成中心" }], revision_reason: "依人工規則建立合成趟次" });
  });

  it("correlates save and review receipts to the requested immutable version", () => {
    const save = parseTransportPlanMutation(saveBody(), KEY);
    expect(parseTransportPlanReceipt({ operation_id: KEY, action: "save_trip",
      decision: null, trip_version_id: TRIP, trip_key: TRIP_KEY, version: 1,
      status: "draft_ready", conflict_count: 0, content_hash: HASH,
      rule_version_id: RULE, committed_at: "2026-09-07T08:00:00Z", replayed: false,
    }, save)).toMatchObject({ tripVersionId: TRIP, persisted: true });
    const decision = parseTransportPlanMutation({ action: "decide_trip", decision: "override",
      trip_version_id: TRIP, expected_trip_key: TRIP_KEY, expected_version: 1,
      expected_content_hash: HASH, expected_conflict_count: 2,
      expected_rule_version_id: RULE, reason: "逐項核對衝突後限此趟次覆核" }, KEY);
    expect(parseTransportPlanReceipt({ operation_id: KEY, action: "decide_trip",
      decision: "override", trip_version_id: TRIP, trip_key: TRIP_KEY, version: 1,
      status: "published", conflict_count: 2, content_hash: HASH,
      rule_version_id: RULE, committed_at: "2026-09-07T08:00:00Z", replayed: true,
    }, decision)).toMatchObject({ decision: "override", replayed: true });
  });

  it("rejects a stale, cross-trip or downgraded receipt", () => {
    const input = parseTransportPlanMutation(saveBody(), KEY);
    expect(() => parseTransportPlanReceipt({ operation_id: KEY, action: "save_trip",
      decision: null, trip_version_id: TRIP, trip_key: TRIP_KEY, version: 2,
      status: "published", conflict_count: 0, content_hash: HASH,
      rule_version_id: RULE, committed_at: "2026-09-07T08:00:00Z", replayed: false,
    }, input)).toThrow("回執與送出內容不一致");
  });

  it("projects a fully reconciled synthetic snapshot", () => {
    const snapshot = buildDemoTransportPlanSnapshot({ serviceDate: "2026-09-07",
      direction: "all", vehicleQuery: "", driverQuery: "", status: "all" });
    expect(snapshot).toMatchObject({ demo: true, policyStatus: "manual_unstandardized",
      policyVersion: 1, clientTotal: 3, matchingTripTotal: 3,
      passengerTotal: 6, capacityConflictTotal: 1, pendingPublicationTotal: 1,
      offlineStatus: "not_configured", exportStatus: "not_configured" });
    expect(new Date(snapshot.staleAfter).getTime() -
      new Date(snapshot.generatedAt).getTime()).toBe(60_000);
  });

  it("filters direction, vehicle, driver and status before all totals", () => {
    const snapshot = buildDemoTransportPlanSnapshot({ serviceDate: "2026-09-07",
      direction: "pickup", vehicleQuery: "VAN-A", driverQuery: "SYN-D02",
      status: "draft_conflicted" });
    expect(snapshot.trips).toHaveLength(1);
    expect(snapshot).toMatchObject({ matchingTripTotal: 1, passengerTotal: 3,
      capacityConflictTotal: 1, pendingPublicationTotal: 1 });
  });

  it("keeps published, conflicted and rejected decisions distinguishable", () => {
    const snapshot = buildDemoTransportPlanSnapshot({ serviceDate: "2026-09-07",
      direction: "all", vehicleQuery: "", driverQuery: "", status: "all" });
    expect(snapshot.trips.map(({ status }) => status)).toEqual([
      "published", "draft_conflicted", "rejected",
    ]);
    expect(snapshot.trips[1]?.conflicts[0]).toMatchObject({
      code: "vehicle_capacity_exceeded", resourceType: "capacity",
    });
  });

  it("fails closed on malformed or cross-tenant snapshots", () => {
    expect(() => projectTransportPlanSnapshot({ row: {},
      expectedOrganizationId: TRIP, expectedBranchId: TRIP_KEY,
      filters: { serviceDate: "2026-09-07", direction: "all",
        vehicleQuery: "", driverQuery: "", status: "all" }, demo: false,
    })).toThrow("INVALID_TRANSPORT_PLAN_SNAPSHOT");
  });
});
