import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  TRANSPORT_DIRECTIONS,
  TRANSPORT_PLAN_STATUSES,
  type TransportPlanFilters,
  type TransportPlanSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const integer = z.union([z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe())]);
const positive = z.union([z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(z.number().int().positive().safe())]);
const text = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const code = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u);

const vehicle = z.object({ code, name: text(160), capacity: positive }).strict();
const driver = z.object({
  membership_id: uuid, user_id: uuid, display_name: text(160),
  employee_code: text(80).nullable(), authorization_label: text(160),
}).strict();
const client = z.object({
  client_id: uuid, client_code: text(120), display_name: text(160),
}).strict();
const passenger = client.extend({
  pickup_label: text(240), dropoff_label: text(240),
}).strict();
const conflict = z.object({
  key: sha256,
  code: z.enum(["vehicle_capacity_exceeded", "vehicle_time_overlap",
    "driver_time_overlap", "client_time_overlap"]),
  message: text(300), resource_type: z.enum(["capacity", "vehicle", "driver", "client"]),
  resource_key: text(160), conflicting_trip_key: uuid.nullable(),
}).strict();
const trip = z.object({
  trip_version_id: uuid, trip_key: uuid, version: positive,
  previous_version_id: uuid.nullable(), content_hash: sha256,
  status: z.enum(TRANSPORT_PLAN_STATUSES), direction: z.enum(TRANSPORT_DIRECTIONS),
  service_date: date, starts_at: timestamp, ends_at: timestamp,
  vehicle_code: code, vehicle_name: text(160), vehicle_capacity: positive,
  driver_membership_id: uuid, driver_user_id: uuid,
  driver_display_name: text(160), driver_employee_code: text(80).nullable(),
  driver_authorization_label: text(160), pickup_label: text(240),
  dropoff_label: text(240), passenger_snapshot: z.array(passenger).min(1).max(100),
  conflict_snapshot: z.array(conflict).max(1_000), rule_version_id: uuid,
  rule_source_status: z.literal("manual_unstandardized"),
  revision_reason: text(1_000), created_by_user_id: uuid,
  created_by_display_name: text(160), created_at: timestamp,
  reviewed_by_user_id: uuid.nullable(), reviewer_display_name: text(160).nullable(),
  reviewed_at: timestamp.nullable(), review_reason: text(1_000).nullable(),
  notification_status: z.literal("not_configured"),
  cancellation: z.object({ id: uuid, reason: text(1000), actorName: text(160), actorId: uuid, cancelledAt: timestamp, planVersionId: uuid, planVersion: positive }).strict().nullable().optional(),
  cancellation_target: z.object({ id: uuid, version: positive, hash: sha256, conflictCount: integer, ruleId: uuid, startsAt: timestamp, vehicleName: text(160) }).strict().nullable().optional(),
}).strict();
const source = z.object({
  organization_id: uuid, branch_id: uuid, generated_at: timestamp,
  policy_status: z.enum(["manual_unstandardized", "not_configured", "ambiguous"]),
  policy_version_id: uuid.nullable(), policy_version: positive.nullable(),
  vehicles: z.array(vehicle).max(100), drivers: z.array(driver).max(200),
  clients: z.array(client).max(200), client_total: integer,
  clients_truncated: z.boolean(), trips: z.array(trip).max(100),
  matching_trip_total: integer, trips_truncated: z.boolean(),
  passenger_total: integer, capacity_conflict_total: integer,
  pending_publication_total: integer, offline_status: z.literal("not_configured"),
  export_status: z.literal("not_configured"),
  notification_provider_status: z.literal("not_configured"),
}).strict();

export type TransportPlanSnapshotSourceRow = z.input<typeof source>;

function invalid(): never {
  throw new Error("INVALID_TRANSPORT_PLAN_SNAPSHOT");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function matchesFilters(item: z.output<typeof trip>, filters: TransportPlanFilters) {
  return item.service_date === filters.serviceDate &&
    (filters.direction === "all" || item.direction === filters.direction) &&
    (!filters.vehicleQuery || `${item.vehicle_code} ${item.vehicle_name}`
      .toLocaleLowerCase("zh-Hant-TW").includes(filters.vehicleQuery.toLocaleLowerCase("zh-Hant-TW"))) &&
    (!filters.driverQuery || `${item.driver_display_name} ${item.driver_employee_code ?? ""}`
      .toLocaleLowerCase("zh-Hant-TW").includes(filters.driverQuery.toLocaleLowerCase("zh-Hant-TW"))) &&
    (filters.status === "all" || item.status === filters.status);
}

export function projectTransportPlanSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: TransportPlanFilters;
  demo: boolean;
}): TransportPlanSnapshot {
  const parsed = source.safeParse(input.row);
  if (!parsed.success) invalid();
  const row = parsed.data;
  const configured = row.policy_status === "manual_unstandardized";
  if (row.organization_id !== input.expectedOrganizationId.toLowerCase() ||
    row.branch_id !== input.expectedBranchId.toLowerCase() ||
    configured !== (row.policy_version_id !== null && row.policy_version !== null) ||
    (!configured && (row.vehicles.length !== 0 || row.drivers.length !== 0)) ||
    !unique(row.vehicles.map(({ code: item }) => item.toLocaleLowerCase("en-US"))) ||
    !unique(row.drivers.map(({ membership_id }) => membership_id)) ||
    !unique(row.clients.map(({ client_id }) => client_id)) ||
    !unique(row.trips.map(({ trip_version_id }) => trip_version_id)) ||
    !unique(row.trips.map(({ trip_key }) => trip_key)) ||
    row.client_total < row.clients.length ||
    row.clients_truncated !== (row.client_total > row.clients.length) ||
    (row.clients_truncated && row.clients.length !== 200) ||
    row.matching_trip_total < row.trips.length ||
    row.trips_truncated !== (row.matching_trip_total > row.trips.length) ||
    (row.trips_truncated && row.trips.length !== 100)) invalid();

  for (const item of row.trips) {
    const passengerIds = item.passenger_snapshot.map(({ client_id }) => client_id);
    const conflictKeys = item.conflict_snapshot.map(({ key }) => key);
    const reviewValues = [item.reviewed_by_user_id, item.reviewer_display_name,
      item.reviewed_at, item.review_reason];
    const hasReview = reviewValues.every((value) => value !== null);
    const isPending = item.status === "draft_ready" || item.status === "draft_conflicted";
    const capacityConflict = item.conflict_snapshot.some(({ code: itemCode }) =>
      itemCode === "vehicle_capacity_exceeded");
    if ((item.status === "cancelled") !== Boolean(item.cancellation) || !matchesFilters(item, input.filters) ||
      Date.parse(item.ends_at) <= Date.parse(item.starts_at) ||
      Date.parse(item.ends_at) - Date.parse(item.starts_at) > 8 * 60 * 60 * 1000 ||
      !unique(passengerIds) || !unique(conflictKeys) ||
      (item.version === 1) !== (item.previous_version_id === null) ||
      (item.status !== "cancelled" && isPending === hasReview) ||
      (isPending &&
        (item.status === "draft_ready") !== (item.conflict_snapshot.length === 0)) ||
      capacityConflict !== (item.passenger_snapshot.length > item.vehicle_capacity) ||
      item.conflict_snapshot.some((entry) =>
        (entry.resource_type === "capacity" && entry.code !== "vehicle_capacity_exceeded") ||
        (entry.resource_type === "client" && !passengerIds.includes(entry.resource_key)))) invalid();
  }

  if (!row.trips_truncated && (
    row.passenger_total !== row.trips.reduce(
      (total, item) => total + (item.status === "cancelled" ? 0 : item.passenger_snapshot.length), 0) ||
    row.capacity_conflict_total !== row.trips.reduce((total, item) => total +
      (item.status === "cancelled" ? [] : item.conflict_snapshot).filter(({ code: itemCode }) =>
        itemCode === "vehicle_capacity_exceeded").length, 0) ||
    row.pending_publication_total !== row.trips.filter(({ status }) =>
      status === "draft_ready" || status === "draft_conflicted").length
  )) invalid();

  return {
    organizationId: row.organization_id, branchId: row.branch_id,
    generatedAt: row.generated_at,
    staleAfter: new Date(Date.parse(row.generated_at) + 60_000).toISOString(),
    filters: input.filters, policyStatus: row.policy_status,
    policyVersionId: row.policy_version_id, policyVersion: row.policy_version,
    vehicles: row.vehicles, drivers: row.drivers.map((item) => ({
      membershipId: item.membership_id, userId: item.user_id,
      displayName: item.display_name, employeeCode: item.employee_code,
      authorizationLabel: item.authorization_label,
    })),
    clients: row.clients.map((item) => ({ clientId: item.client_id,
      clientCode: item.client_code, displayName: item.display_name })),
    clientTotal: row.client_total, clientsTruncated: row.clients_truncated,
    trips: row.trips.map((item) => ({
      tripVersionId: item.trip_version_id, tripKey: item.trip_key,
      version: item.version, previousVersionId: item.previous_version_id,
      contentHash: item.content_hash, status: item.status, direction: item.direction,
      serviceDate: item.service_date, startsAt: item.starts_at, endsAt: item.ends_at,
      vehicle: { code: item.vehicle_code, name: item.vehicle_name,
        capacity: item.vehicle_capacity },
      driver: { membershipId: item.driver_membership_id,
        userId: item.driver_user_id, displayName: item.driver_display_name,
        employeeCode: item.driver_employee_code,
        authorizationLabel: item.driver_authorization_label },
      pickupLabel: item.pickup_label, dropoffLabel: item.dropoff_label,
      passengers: item.passenger_snapshot.map((entry) => ({
        clientId: entry.client_id, clientCode: entry.client_code,
        displayName: entry.display_name, pickupLabel: entry.pickup_label,
        dropoffLabel: entry.dropoff_label })),
      conflicts: item.conflict_snapshot.map((entry) => ({ key: entry.key,
        code: entry.code, message: entry.message, resourceType: entry.resource_type,
        resourceKey: entry.resource_key, conflictingTripKey: entry.conflicting_trip_key })),
      ruleVersionId: item.rule_version_id, ruleSourceStatus: item.rule_source_status,
      revisionReason: item.revision_reason, createdByUserId: item.created_by_user_id,
      createdByDisplayName: item.created_by_display_name, createdAt: item.created_at,
      reviewedByUserId: item.reviewed_by_user_id,
      reviewerDisplayName: item.reviewer_display_name, reviewedAt: item.reviewed_at,
      reviewReason: item.review_reason,
      notificationStatus: item.notification_status,
      cancellation: item.cancellation ?? null,
      cancellationTarget: item.cancellation_target ?? null,
    })),
    matchingTripTotal: row.matching_trip_total,
    tripsTruncated: row.trips_truncated, passengerTotal: row.passenger_total,
    capacityConflictTotal: row.capacity_conflict_total,
    pendingPublicationTotal: row.pending_publication_total,
    offlineStatus: row.offline_status, exportStatus: row.export_status,
    notificationProviderStatus: row.notification_provider_status,
    demo: input.demo,
  };
}
