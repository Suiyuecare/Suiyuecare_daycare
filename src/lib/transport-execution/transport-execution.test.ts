import { describe, expect, it } from "vitest";

import { buildDemoTransportExecutionSnapshot } from "./demo";
import {
  parseTransportExecutionMutation,
  parseTransportExecutionReceipt,
} from "./parser";
import { projectTransportExecutionSnapshot } from "./projection";
import { parseTransportExecutionFilters } from "./query";

const KEY = "48900000-0000-4000-8000-000000000001";
const PLAN = "48910000-0000-4000-8000-000000000001";
const TRIP = "48920000-0000-4000-8000-000000000001";
const CLIENT = "48930000-0000-4000-8000-000000000001";
const EVENT = "48940000-0000-4000-8000-000000000001";
const HASH = "a".repeat(64);
const base = { action: "append_event", event_type: "trip_started",
  plan_version_id: PLAN, expected_trip_key: TRIP,
  expected_plan_content_hash: HASH, expected_sequence: 0,
  occurred_at: "2026-09-07T08:00:00+08:00", client_id: null,
  note: null, resolves_pairing: false };

function filters() {
  return { serviceDate: "2026-09-07", vehicleQuery: "", driverQuery: "",
    completionStatus: "all" as const, exceptionStatus: "all" as const };
}

function receipt(overrides: Record<string, unknown> = {}) {
  return { operation_id: KEY, event_id: EVENT, event_type: "trip_started",
    plan_version_id: PLAN, trip_key: TRIP, client_id: null, sequence: 1,
    status: "in_progress", actual_started_at: "2026-09-07T00:00:00Z",
    actual_completed_at: null, exception_count: 0, unmatched_passenger_count: 2,
    late_seconds: 0, resolves_pairing: false, event_content_hash: "b".repeat(64),
    plan_content_hash: HASH, committed_at: "2026-09-07T00:00:01Z",
    replayed: false, ...overrides };
}

describe("Page-48 transport execution contracts", () => {
  it("parses strict filters and rejects unknown or duplicate query keys", () => {
    expect(parseTransportExecutionFilters(new URLSearchParams(
      "date=2026-09-07&vehicle=VAN&driver=%E7%94%B2&status=in_progress&exception=unmatched",
    ), "2026-09-08")).toEqual({ serviceDate: "2026-09-07", vehicleQuery: "VAN",
      driverQuery: "甲", completionStatus: "in_progress", exceptionStatus: "unmatched" });
    expect(() => parseTransportExecutionFilters(new URLSearchParams(
      "date=2026-09-07&date=2026-09-08"), "2026-09-07"))
      .toThrow("INVALID_TRANSPORT_EXECUTION_QUERY");
    expect(() => parseTransportExecutionFilters(new URLSearchParams("extra=1"),
      "2026-09-07")).toThrow("INVALID_TRANSPORT_EXECUTION_QUERY");
  });

  it("normalizes a start event with an actor-scoped operation key", () => {
    expect(parseTransportExecutionMutation(base, KEY)).toMatchObject({
      eventType: "trip_started", expectedSequence: 0, clientId: null,
      occurredAt: "2026-09-07T00:00:00.000Z", idempotencyKey: KEY,
    });
  });

  it.each([
    [{ ...base, event_type: "passenger_boarded", client_id: CLIENT,
      expected_sequence: 1 }, "passenger_boarded"],
    [{ ...base, event_type: "passenger_alighted", client_id: CLIENT,
      expected_sequence: 2 }, "passenger_alighted"],
    [{ ...base, event_type: "exception_recorded", client_id: CLIENT,
      expected_sequence: 3, note: "人工確認個案未搭乘並完成聯繫。", resolves_pairing: true },
    "exception_recorded"],
    [{ ...base, event_type: "trip_completed", expected_sequence: 4,
      note: "全部乘客已核對完成。" }, "trip_completed"],
  ])("accepts the exact %s contract", (body, eventType) => {
    expect(parseTransportExecutionMutation(body, KEY)).toMatchObject({ eventType });
  });

  it.each([
    [{ ...base, unexpected: true }],
    [{ ...base, event_type: "passenger_boarded", client_id: null }],
    [{ ...base, event_type: "exception_recorded", note: null }],
    [{ ...base, event_type: "exception_recorded", note: "人工處置完成",
      resolves_pairing: true, client_id: null }],
    [{ ...base, event_type: "trip_completed", client_id: CLIENT }],
  ])("rejects mismatched or expanded event fields", (body) => {
    expect(() => parseTransportExecutionMutation(body, KEY))
      .toThrow("事件");
  });

  it("requires a valid idempotency key", () => {
    expect(() => parseTransportExecutionMutation(base, "bad-key"))
      .toThrow("冪等鍵");
  });

  it("correlates an exact receipt and keeps replay explicit", () => {
    const input = parseTransportExecutionMutation(base, KEY);
    expect(parseTransportExecutionReceipt(receipt({ replayed: true }), input))
      .toMatchObject({ eventId: EVENT, sequence: 1, status: "in_progress",
        replayed: true, persisted: true, demo: false });
  });

  it("rejects a stale, cross-plan or downgraded receipt", () => {
    const input = parseTransportExecutionMutation(base, KEY);
    expect(() => parseTransportExecutionReceipt(receipt({ sequence: 2 }), input))
      .toThrow("回執與送出事件不一致");
    expect(() => parseTransportExecutionReceipt(receipt({ plan_content_hash: "c".repeat(64) }),
      input)).toThrow("回執與送出事件不一致");
  });

  it("projects a fully reconciled synthetic snapshot", () => {
    const snapshot = buildDemoTransportExecutionSnapshot(filters());
    expect(snapshot).toMatchObject({ demo: true, matchingTripTotal: 3,
      pendingTotal: 1, inProgressTotal: 1, completedTotal: 1,
      lateTotal: 1, unmatchedTripTotal: 1,
      lateDefinition: "actual_start_after_planned_start", offlineStatus: "not_configured" });
    expect(snapshot.trips.map(({ status }) => status)).toEqual([
      "not_started", "in_progress", "completed",
    ]);
    expect(snapshot.trips[1]?.passengers.map(({ pairingStatus }) => pairingStatus))
      .toEqual(["paired", "pending"]);
  });

  it("filters vehicle, driver, state and unmatched before every total", () => {
    const snapshot = buildDemoTransportExecutionSnapshot({ ...filters(),
      vehicleQuery: "SYN-VAN-02", driverQuery: "駕駛乙",
      completionStatus: "in_progress", exceptionStatus: "unmatched" });
    expect(snapshot.trips).toHaveLength(1);
    expect(snapshot).toMatchObject({ matchingTripTotal: 1, pendingTotal: 0,
      inProgressTotal: 1, completedTotal: 0, lateTotal: 0,
      unmatchedTripTotal: 1 });
  });

  it("keeps planned, actual, exception and pairing evidence linked", () => {
    const snapshot = buildDemoTransportExecutionSnapshot(filters());
    const active = snapshot.trips[1]!;
    expect(active.planContentHash).toHaveLength(64);
    expect(active.events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4]);
    expect(active.exceptionCount).toBe(1);
    expect(active.unmatchedPassengerCount).toBe(1);
    expect(active.events[1]).toMatchObject({ eventType: "passenger_boarded",
      clientId: active.passengers[0]?.clientId });
  });

  it("fails closed on malformed snapshots and keeps demo tenant identifiers synthetic", () => {
    expect(() => projectTransportExecutionSnapshot({ row: {},
      expectedOrganizationId: PLAN, expectedBranchId: TRIP, filters: filters(), demo: false }))
      .toThrow("INVALID_TRANSPORT_EXECUTION_SNAPSHOT");
    const snapshot = buildDemoTransportExecutionSnapshot(filters());
    expect(snapshot.organizationId).not.toBe(PLAN);
  });
});
