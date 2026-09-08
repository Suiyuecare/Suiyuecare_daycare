import { projectTransportPlanSnapshot } from "./projection";
import type { TransportPlanFilters } from "./types";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const RULE_ID = "47000000-0000-4000-8000-000000000001";
const DRIVER_A = "47010000-0000-4000-8000-000000000001";
const DRIVER_B = "47010000-0000-4000-8000-000000000002";
const USER_A = "47020000-0000-4000-8000-000000000001";
const USER_B = "47020000-0000-4000-8000-000000000002";
const CLIENT_A = "47030000-0000-4000-8000-000000000001";
const CLIENT_B = "47030000-0000-4000-8000-000000000002";
const CLIENT_C = "47030000-0000-4000-8000-000000000003";
const CREATOR = "47040000-0000-4000-8000-000000000001";
const REVIEWER = "47040000-0000-4000-8000-000000000002";

const vehicles = [
  { code: "VAN-A", name: "合成接送車 A", capacity: 2 },
  { code: "VAN-B", name: "合成接送車 B", capacity: 8 },
];
const drivers = [
  { membership_id: DRIVER_A, user_id: USER_A, display_name: "合成駕駛甲",
    employee_code: "SYN-D01", authorization_label: "機構人工授權版本" },
  { membership_id: DRIVER_B, user_id: USER_B, display_name: "合成駕駛乙",
    employee_code: "SYN-D02", authorization_label: "機構人工授權版本" },
];
const clients = [
  { client_id: CLIENT_A, client_code: "SYN-T01", display_name: "合成個案甲" },
  { client_id: CLIENT_B, client_code: "SYN-T02", display_name: "合成個案乙" },
  { client_id: CLIENT_C, client_code: "SYN-T03", display_name: "合成個案丙" },
];

function passenger(client: typeof clients[number], pickup: string, dropoff: string) {
  return { ...client, pickup_label: pickup, dropoff_label: dropoff };
}

function baseTrip(input: {
  suffix: string; status: "published" | "draft_conflicted" | "rejected";
  vehicle: typeof vehicles[number]; driver: typeof drivers[number];
  passengers: ReturnType<typeof passenger>[]; direction: "pickup" | "dropoff";
  startsAt: string; endsAt: string; conflicts?: Array<Record<string, unknown>>;
}) {
  const reviewed = input.status === "published" || input.status === "rejected";
  return {
    trip_version_id: `47100000-0000-4000-8000-0000000000${input.suffix}`,
    trip_key: `47110000-0000-4000-8000-0000000000${input.suffix}`,
    version: 1, previous_version_id: null,
    content_hash: input.suffix.slice(-1).repeat(64),
    status: input.status, direction: input.direction,
    service_date: input.startsAt.slice(0, 10), starts_at: input.startsAt,
    ends_at: input.endsAt, vehicle_code: input.vehicle.code,
    vehicle_name: input.vehicle.name, vehicle_capacity: input.vehicle.capacity,
    driver_membership_id: input.driver.membership_id,
    driver_user_id: input.driver.user_id, driver_display_name: input.driver.display_name,
    driver_employee_code: input.driver.employee_code,
    driver_authorization_label: input.driver.authorization_label,
    pickup_label: input.direction === "pickup" ? "合成集合點" : "合成日照中心",
    dropoff_label: input.direction === "pickup" ? "合成日照中心" : "合成返家點",
    passenger_snapshot: input.passengers,
    conflict_snapshot: input.conflicts ?? [], rule_version_id: RULE_ID,
    rule_source_status: "manual_unstandardized" as const,
    revision_reason: "合成交通計畫驗證案例", created_by_user_id: CREATOR,
    created_by_display_name: "合成交通主管", created_at: input.startsAt,
    reviewed_by_user_id: reviewed ? REVIEWER : null,
    reviewer_display_name: reviewed ? "合成覆核主管" : null,
    reviewed_at: reviewed ? input.endsAt : null,
    review_reason: reviewed ? (input.status === "published" ?
      "合成無衝突發布驗證" : "合成駁回驗證資料") : null,
    notification_status: "not_configured" as const,
  };
}

export function buildDemoTransportPlanSnapshot(filters: TransportPlanFilters) {
  const prefix = filters.serviceDate;
  const conflicts = [{ key: "d".repeat(64), code: "vehicle_capacity_exceeded" as const,
    message: "乘員 3 人超過車輛容量 2 人。", resource_type: "capacity" as const,
    resource_key: "VAN-A", conflicting_trip_key: null }];
  const candidates = [
    baseTrip({ suffix: "01", status: "published", vehicle: vehicles[1]!,
      driver: drivers[0]!, passengers: [passenger(clients[0]!, "合成住址 A", "合成日照中心"),
        passenger(clients[1]!, "合成住址 B", "合成日照中心")],
      direction: "pickup", startsAt: `${prefix}T08:00:00+08:00`,
      endsAt: `${prefix}T09:00:00+08:00` }),
    baseTrip({ suffix: "02", status: "draft_conflicted", vehicle: vehicles[0]!,
      driver: drivers[1]!, passengers: clients.map((item, index) =>
        passenger(item, `合成住址 ${index + 1}`, "合成日照中心")),
      direction: "pickup", startsAt: `${prefix}T09:15:00+08:00`,
      endsAt: `${prefix}T10:00:00+08:00`, conflicts }),
    baseTrip({ suffix: "03", status: "rejected", vehicle: vehicles[1]!,
      driver: drivers[1]!, passengers: [passenger(clients[2]!, "合成日照中心", "合成住址 C")],
      direction: "dropoff", startsAt: `${prefix}T16:00:00+08:00`,
      endsAt: `${prefix}T17:00:00+08:00` }),
  ];
  const q = (value: string) => value.toLocaleLowerCase("zh-Hant-TW");
  const trips = candidates.filter((item) =>
    (filters.direction === "all" || item.direction === filters.direction) &&
    (!filters.vehicleQuery || q(`${item.vehicle_code} ${item.vehicle_name}`).includes(q(filters.vehicleQuery))) &&
    (!filters.driverQuery || q(`${item.driver_display_name} ${item.driver_employee_code ?? ""}`).includes(q(filters.driverQuery))) &&
    (filters.status === "all" || item.status === filters.status));
  return projectTransportPlanSnapshot({
    expectedOrganizationId: ORGANIZATION_ID, expectedBranchId: BRANCH_ID,
    filters, demo: true, row: {
      organization_id: ORGANIZATION_ID, branch_id: BRANCH_ID,
      generated_at: new Date().toISOString(), policy_status: "manual_unstandardized",
      policy_version_id: RULE_ID, policy_version: 1, vehicles, drivers, clients,
      client_total: clients.length, clients_truncated: false, trips,
      matching_trip_total: trips.length, trips_truncated: false,
      passenger_total: trips.reduce((total, item) => total + item.passenger_snapshot.length, 0),
      capacity_conflict_total: trips.reduce((total, item) => total +
        item.conflict_snapshot.filter(({ code }) => code === "vehicle_capacity_exceeded").length, 0),
      pending_publication_total: trips.filter(({ status }) =>
        status === "draft_conflicted").length,
      offline_status: "not_configured", export_status: "not_configured",
      notification_provider_status: "not_configured",
    },
  });
}
