import { projectTransportExecutionSnapshot } from "./projection";
import type { TransportExecutionFilters } from "./types";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const DRIVER_A = "48010000-0000-4000-8000-000000000001";
const DRIVER_B = "48010000-0000-4000-8000-000000000002";
const DRIVER_USER_A = "48020000-0000-4000-8000-000000000001";
const DRIVER_USER_B = "48020000-0000-4000-8000-000000000002";
const CLIENT_A = "48030000-0000-4000-8000-000000000001";
const CLIENT_B = "48030000-0000-4000-8000-000000000002";
const CLIENT_C = "48030000-0000-4000-8000-000000000003";
const ACTOR = "48040000-0000-4000-8000-000000000001";

type Passenger = {
  client_id: string; client_code: string; display_name: string;
  pickup_label: string; dropoff_label: string; boarded_at: string | null;
  alighted_at: string | null; pairing_resolved: boolean; resolution_note: string | null;
};

function passenger(input: {
  id: string; code: string; name: string; pickup: string; dropoff: string;
  boarded?: string; alighted?: string; resolution?: string;
}): Passenger {
  return { client_id: input.id, client_code: input.code, display_name: input.name,
    pickup_label: input.pickup, dropoff_label: input.dropoff,
    boarded_at: input.boarded ?? null, alighted_at: input.alighted ?? null,
    pairing_resolved: Boolean(input.resolution), resolution_note: input.resolution ?? null };
}

function event(input: {
  trip: string; sequence: number; type: "trip_started" | "passenger_boarded" |
    "passenger_alighted" | "exception_recorded" | "trip_completed";
  occurred: string; client?: string; note?: string; resolves?: boolean;
}) {
  const suffix = `${input.trip}${String(input.sequence).padStart(2, "0")}`;
  return { event_id: `48120000-0000-4000-8000-00000000${suffix}`,
    sequence: input.sequence, event_type: input.type, client_id: input.client ?? null,
    occurred_at: input.occurred, note: input.note ?? null,
    resolves_pairing: input.resolves ?? false, actor_user_id: ACTOR,
    actor_display_name: "合成接送人員", content_hash: String(input.sequence).repeat(64),
    committed_at: input.occurred };
}

function plan(input: {
  index: string; date: string; start: string; end: string; vehicle: string;
  driverMembership: string; driverUser: string; driverName: string;
  direction: "pickup" | "dropoff"; passengers: Passenger[];
  events: ReturnType<typeof event>[]; decision?: "publish" | "override";
}) {
  const actualStarted = input.events.find(({ event_type }) => event_type === "trip_started")?.occurred_at ?? null;
  const actualCompleted = input.events.find(({ event_type }) => event_type === "trip_completed")?.occurred_at ?? null;
  const status = !actualStarted ? "not_started" : actualCompleted ? "completed" : "in_progress";
  const unmatched = status === "not_started" ? 0 : input.passengers.filter((item) =>
    !(item.pairing_resolved || (item.boarded_at && item.alighted_at))).length;
  return { plan_version_id: `48100000-0000-4000-8000-0000000000${input.index}`,
    trip_key: `48110000-0000-4000-8000-0000000000${input.index}`,
    plan_version: 1, plan_content_hash: input.index.slice(-1).repeat(64),
    plan_decision: input.decision ?? "publish", direction: input.direction,
    service_date: input.date, planned_starts_at: input.start,
    planned_ends_at: input.end, vehicle_code: `SYN-VAN-${input.index}`,
    vehicle_name: input.vehicle, driver_membership_id: input.driverMembership,
    driver_user_id: input.driverUser, driver_display_name: input.driverName,
    pickup_label: input.direction === "pickup" ? "合成集合區" : "合成日照中心",
    dropoff_label: input.direction === "pickup" ? "合成日照中心" : "合成返家區",
    passengers: input.passengers, events: input.events, events_truncated: false,
    execution_sequence: input.events.length, status, actual_started_at: actualStarted,
    actual_completed_at: actualCompleted,
    late_seconds: actualStarted ? Math.max(0, Math.floor(
      (Date.parse(actualStarted) - Date.parse(input.start)) / 1_000,
    )) : null,
    exception_count: input.events.filter(({ event_type }) =>
      event_type === "exception_recorded").length,
    unmatched_passenger_count: unmatched };
}

export function buildDemoTransportExecutionSnapshot(filters: TransportExecutionFilters) {
  const date = filters.serviceDate;
  const candidates = [
    plan({ index: "01", date, direction: "pickup",
      start: `${date}T08:00:00+08:00`, end: `${date}T09:00:00+08:00`,
      vehicle: "合成接送車 A", driverMembership: DRIVER_A,
      driverUser: DRIVER_USER_A, driverName: "合成駕駛甲", passengers: [
        passenger({ id: CLIENT_A, code: "SYN-E01", name: "合成個案甲",
          pickup: "合成住址 A", dropoff: "合成日照中心" }),
        passenger({ id: CLIENT_B, code: "SYN-E02", name: "合成個案乙",
          pickup: "合成住址 B", dropoff: "合成日照中心" }),
      ], events: [] }),
    plan({ index: "02", date, direction: "pickup",
      start: `${date}T09:15:00+08:00`, end: `${date}T10:00:00+08:00`,
      vehicle: "合成接送車 B", driverMembership: DRIVER_B,
      driverUser: DRIVER_USER_B, driverName: "合成駕駛乙", passengers: [
        passenger({ id: CLIENT_A, code: "SYN-E01", name: "合成個案甲",
          pickup: "合成住址 A", dropoff: "合成日照中心",
          boarded: `${date}T09:20:00+08:00`, alighted: `${date}T09:40:00+08:00` }),
        passenger({ id: CLIENT_C, code: "SYN-E03", name: "合成個案丙",
          pickup: "合成住址 C", dropoff: "合成日照中心" }),
      ], events: [
        event({ trip: "02", sequence: 1, type: "trip_started",
          occurred: `${date}T09:15:00+08:00` }),
        event({ trip: "02", sequence: 2, type: "passenger_boarded", client: CLIENT_A,
          occurred: `${date}T09:20:00+08:00` }),
        event({ trip: "02", sequence: 3, type: "passenger_alighted", client: CLIENT_A,
          occurred: `${date}T09:40:00+08:00` }),
        event({ trip: "02", sequence: 4, type: "exception_recorded",
          occurred: `${date}T09:42:00+08:00`, note: "合成展示：尚有一位乘客待確認。" }),
      ] }),
    plan({ index: "03", date, direction: "dropoff", decision: "override",
      start: `${date}T16:00:00+08:00`, end: `${date}T17:00:00+08:00`,
      vehicle: "合成接送車 C", driverMembership: DRIVER_A,
      driverUser: DRIVER_USER_A, driverName: "合成駕駛甲", passengers: [
        passenger({ id: CLIENT_C, code: "SYN-E03", name: "合成個案丙",
          pickup: "合成日照中心", dropoff: "合成住址 C",
          boarded: `${date}T16:05:00+08:00`, alighted: `${date}T16:45:00+08:00` }),
      ], events: [
        event({ trip: "03", sequence: 1, type: "trip_started",
          occurred: `${date}T16:05:00+08:00` }),
        event({ trip: "03", sequence: 2, type: "passenger_boarded", client: CLIENT_C,
          occurred: `${date}T16:05:00+08:00` }),
        event({ trip: "03", sequence: 3, type: "passenger_alighted", client: CLIENT_C,
          occurred: `${date}T16:45:00+08:00` }),
        event({ trip: "03", sequence: 4, type: "trip_completed",
          occurred: `${date}T16:50:00+08:00` }),
      ] }),
  ];
  const q = (value: string) => value.toLocaleLowerCase("zh-Hant-TW");
  const trips = candidates.filter((item) =>
    (!filters.vehicleQuery || q(`${item.vehicle_code} ${item.vehicle_name}`).includes(q(filters.vehicleQuery))) &&
    (!filters.driverQuery || q(item.driver_display_name).includes(q(filters.driverQuery))) &&
    (filters.completionStatus === "all" || item.status === filters.completionStatus) &&
    (filters.exceptionStatus === "all" ||
      (filters.exceptionStatus === "with_exception" && item.exception_count > 0) ||
      (filters.exceptionStatus === "without_exception" && item.exception_count === 0) ||
      (filters.exceptionStatus === "late" && (item.late_seconds ?? 0) > 0) ||
      (filters.exceptionStatus === "unmatched" && item.unmatched_passenger_count > 0)));
  return projectTransportExecutionSnapshot({
    expectedOrganizationId: ORGANIZATION_ID, expectedBranchId: BRANCH_ID,
    filters, demo: true, row: { organization_id: ORGANIZATION_ID, branch_id: BRANCH_ID,
      generated_at: new Date().toISOString(), trips, matching_trip_total: trips.length,
      trips_truncated: false,
      pending_total: trips.filter(({ status }) => status === "not_started").length,
      in_progress_total: trips.filter(({ status }) => status === "in_progress").length,
      completed_total: trips.filter(({ status }) => status === "completed").length,
      late_total: trips.filter(({ late_seconds }) => (late_seconds ?? 0) > 0).length,
      unmatched_trip_total: trips.filter(({ unmatched_passenger_count }) =>
        unmatched_passenger_count > 0).length,
      late_definition: "actual_start_after_planned_start",
      offline_status: "not_configured", export_status: "not_configured",
      notification_status: "not_configured" },
  });
}
