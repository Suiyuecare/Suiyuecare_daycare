import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import type {
  TransportExecutionFilters,
  TransportExecutionPassenger,
  TransportExecutionSnapshot,
} from "./types";
import {
  TRANSPORT_EXECUTION_EVENT_TYPES,
  TRANSPORT_EXECUTION_STATUSES,
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
const text = (maximum: number, minimum = 1) => z.string().trim().min(minimum).max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const code = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u);

const passenger = z.object({
  client_id: uuid, client_code: text(120), display_name: text(160),
  pickup_label: text(240), dropoff_label: text(240), boarded_at: timestamp.nullable(),
  alighted_at: timestamp.nullable(), pairing_resolved: z.boolean(),
  resolution_note: text(1_000, 8).nullable(),
}).strict();
const event = z.object({
  event_id: uuid, sequence: positive, event_type: z.enum(TRANSPORT_EXECUTION_EVENT_TYPES),
  client_id: uuid.nullable(), occurred_at: timestamp, note: text(1_000, 8).nullable(),
  resolves_pairing: z.boolean(), actor_user_id: uuid,
  actor_display_name: text(160), content_hash: sha256, committed_at: timestamp,
}).strict();
const trip = z.object({
  plan_version_id: uuid, trip_key: uuid, plan_version: positive,
  plan_content_hash: sha256, plan_decision: z.enum(["publish", "override"]),
  direction: z.enum(["pickup", "dropoff"]), service_date: date,
  planned_starts_at: timestamp, planned_ends_at: timestamp,
  vehicle_code: code, vehicle_name: text(160), driver_membership_id: uuid,
  driver_user_id: uuid, driver_display_name: text(160), pickup_label: text(240),
  dropoff_label: text(240), passengers: z.array(passenger).min(1).max(100),
  events: z.array(event).max(300), events_truncated: z.boolean(), execution_sequence: integer,
  status: z.enum(TRANSPORT_EXECUTION_STATUSES), actual_started_at: timestamp.nullable(),
  actual_completed_at: timestamp.nullable(), late_seconds: integer.nullable(),
  exception_count: integer, unmatched_passenger_count: integer,
}).strict();
const source = z.object({
  organization_id: uuid, branch_id: uuid, generated_at: timestamp,
  trips: z.array(trip).max(100), matching_trip_total: integer,
  trips_truncated: z.boolean(), pending_total: integer, in_progress_total: integer,
  completed_total: integer, late_total: integer, unmatched_trip_total: integer,
  late_definition: z.literal("actual_start_after_planned_start"),
  offline_status: z.literal("not_configured"), export_status: z.literal("not_configured"),
  notification_status: z.literal("not_configured"),
}).strict();

export type TransportExecutionSnapshotSourceRow = z.input<typeof source>;

function invalid(): never {
  throw new Error("INVALID_TRANSPORT_EXECUTION_SNAPSHOT");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function taipeiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric",
    month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function passengerProjection(item: z.output<typeof passenger>): TransportExecutionPassenger {
  const pairingStatus = item.pairing_resolved ? "resolved_exception" : item.alighted_at ?
    "paired" : item.boarded_at ? "onboard" : "pending";
  return { clientId: item.client_id, clientCode: item.client_code,
    displayName: item.display_name, pickupLabel: item.pickup_label,
    dropoffLabel: item.dropoff_label, boardedAt: item.boarded_at,
    alightedAt: item.alighted_at, pairingResolved: item.pairing_resolved,
    resolutionNote: item.resolution_note, pairingStatus };
}

function matches(item: z.output<typeof trip>, filters: TransportExecutionFilters) {
  const vehicle = `${item.vehicle_code} ${item.vehicle_name}`.toLocaleLowerCase("zh-Hant-TW");
  const driver = item.driver_display_name.toLocaleLowerCase("zh-Hant-TW");
  return item.service_date === filters.serviceDate &&
    (!filters.vehicleQuery || vehicle.includes(filters.vehicleQuery.toLocaleLowerCase("zh-Hant-TW"))) &&
    (!filters.driverQuery || driver.includes(filters.driverQuery.toLocaleLowerCase("zh-Hant-TW"))) &&
    (filters.completionStatus === "all" || item.status === filters.completionStatus) &&
    (filters.exceptionStatus === "all" ||
      (filters.exceptionStatus === "with_exception" && item.exception_count > 0) ||
      (filters.exceptionStatus === "without_exception" && item.exception_count === 0) ||
      (filters.exceptionStatus === "late" && (item.late_seconds ?? 0) > 0) ||
      (filters.exceptionStatus === "unmatched" && item.unmatched_passenger_count > 0));
}

export function projectTransportExecutionSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: TransportExecutionFilters;
  demo: boolean;
}): TransportExecutionSnapshot {
  const parsed = source.safeParse(input.row);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== input.expectedOrganizationId.toLowerCase() ||
    row.branch_id !== input.expectedBranchId.toLowerCase() ||
    !unique(row.trips.map(({ trip_key }) => trip_key)) ||
    !unique(row.trips.map(({ plan_version_id }) => plan_version_id)) ||
    row.matching_trip_total < row.trips.length ||
    row.trips_truncated !== (row.matching_trip_total > row.trips.length) ||
    (row.trips_truncated && row.trips.length !== 100)) invalid();

  for (const item of row.trips) {
    const passengers = item.passengers.map(passengerProjection);
    const passengerIds = item.passengers.map(({ client_id }) => client_id);
    const eventSequences = item.events.map(({ sequence }) => sequence);
    const expectedFirst = item.events_truncated ? item.execution_sequence - item.events.length + 1 : 1;
    const unmatched = item.status === "not_started" ? 0 : passengers.filter(({ pairingStatus }) =>
      pairingStatus === "pending" || pairingStatus === "onboard").length;
    const late = item.actual_started_at === null ? null : Math.max(0, Math.floor(
      (Date.parse(item.actual_started_at) - Date.parse(item.planned_starts_at)) / 1_000,
    ));
    const derivedStatus = item.execution_sequence === 0 ? "not_started" :
      item.actual_completed_at === null ? "in_progress" : "completed";
    if (!matches(item, input.filters) ||
      Date.parse(item.planned_ends_at) <= Date.parse(item.planned_starts_at) ||
      !unique(passengerIds) ||
      !unique(item.events.map(({ event_id }) => event_id)) ||
      !unique(eventSequences.map(String)) ||
      item.events_truncated !== (item.execution_sequence > item.events.length) ||
      (!item.events_truncated && item.execution_sequence !== item.events.length) ||
      (item.events.length > 0 && (eventSequences[0] !== expectedFirst ||
        eventSequences.some((value, index) => value !== expectedFirst + index))) ||
      derivedStatus !== item.status ||
      (item.status === "not_started") !== (item.actual_started_at === null) ||
      (item.status === "completed") !== (item.actual_completed_at !== null) ||
      item.unmatched_passenger_count !== unmatched || item.late_seconds !== late ||
      (item.status === "completed" && unmatched !== 0) ||
      item.passengers.some((entry) =>
        (entry.alighted_at !== null && entry.boarded_at === null) ||
        (entry.boarded_at !== null && entry.alighted_at !== null &&
          Date.parse(entry.alighted_at) < Date.parse(entry.boarded_at)) ||
        entry.pairing_resolved !== (entry.resolution_note !== null)) ||
      item.events.some((entry, index) =>
        taipeiDate(entry.occurred_at) !== item.service_date ||
        (index > 0 && Date.parse(entry.occurred_at) <
          Date.parse(item.events[index - 1]!.occurred_at)) ||
        ((entry.event_type === "trip_started" || entry.event_type === "trip_completed") &&
          entry.client_id !== null) ||
        ((entry.event_type === "passenger_boarded" ||
          entry.event_type === "passenger_alighted") &&
          (entry.client_id === null || !passengerIds.includes(entry.client_id) ||
            entry.note !== null || entry.resolves_pairing)) ||
        (entry.event_type === "exception_recorded" &&
          (entry.note === null || (entry.client_id !== null &&
            !passengerIds.includes(entry.client_id)) ||
            (entry.resolves_pairing && entry.client_id === null))) ||
        (entry.event_type !== "exception_recorded" && entry.resolves_pairing) ||
        ((entry.event_type === "trip_started" ||
          entry.event_type === "passenger_boarded" ||
          entry.event_type === "passenger_alighted") && entry.note !== null)) ||
      (!item.events_truncated && item.exception_count !== item.events.filter(
        ({ event_type }) => event_type === "exception_recorded").length)) invalid();
    if (!item.events_truncated) {
      const starts = item.events.filter(({ event_type }) => event_type === "trip_started");
      const completions = item.events.filter(({ event_type }) => event_type === "trip_completed");
      if ((item.execution_sequence === 0 && (starts.length || completions.length)) ||
        (item.execution_sequence > 0 && (starts.length !== 1 ||
          item.events[0]?.event_type !== "trip_started")) || completions.length > 1 ||
        (completions.length === 1 && item.events.at(-1)?.event_type !== "trip_completed") ||
        item.actual_started_at !== (starts[0]?.occurred_at ?? null) ||
        item.actual_completed_at !== (completions[0]?.occurred_at ?? null)) invalid();
      for (const person of item.passengers) {
        const boards = item.events.filter((entry) =>
          entry.event_type === "passenger_boarded" && entry.client_id === person.client_id);
        const alights = item.events.filter((entry) =>
          entry.event_type === "passenger_alighted" && entry.client_id === person.client_id);
        const resolutions = item.events.filter((entry) => entry.event_type === "exception_recorded" &&
          entry.client_id === person.client_id && entry.resolves_pairing);
        if (boards.length > 1 || alights.length > 1 || resolutions.length > 1 ||
          person.boarded_at !== (boards[0]?.occurred_at ?? null) ||
          person.alighted_at !== (alights[0]?.occurred_at ?? null) ||
          person.resolution_note !== (resolutions[0]?.note ?? null)) invalid();
      }
    }
  }

  if (!row.trips_truncated) {
    const totals = {
      pending: row.trips.filter(({ status }) => status === "not_started").length,
      inProgress: row.trips.filter(({ status }) => status === "in_progress").length,
      completed: row.trips.filter(({ status }) => status === "completed").length,
      late: row.trips.filter(({ late_seconds }) => (late_seconds ?? 0) > 0).length,
      unmatched: row.trips.filter(({ unmatched_passenger_count }) =>
        unmatched_passenger_count > 0).length,
    };
    if (row.pending_total !== totals.pending || row.in_progress_total !== totals.inProgress ||
      row.completed_total !== totals.completed || row.late_total !== totals.late ||
      row.unmatched_trip_total !== totals.unmatched) invalid();
  }

  return { organizationId: row.organization_id, branchId: row.branch_id,
    generatedAt: row.generated_at,
    staleAfter: new Date(Date.parse(row.generated_at) + 60_000).toISOString(),
    filters: input.filters, trips: row.trips.map((item) => ({
      planVersionId: item.plan_version_id, tripKey: item.trip_key,
      planVersion: item.plan_version, planContentHash: item.plan_content_hash,
      planDecision: item.plan_decision, direction: item.direction,
      serviceDate: item.service_date, plannedStartsAt: item.planned_starts_at,
      plannedEndsAt: item.planned_ends_at, vehicleCode: item.vehicle_code,
      vehicleName: item.vehicle_name, driverMembershipId: item.driver_membership_id,
      driverUserId: item.driver_user_id, driverDisplayName: item.driver_display_name,
      pickupLabel: item.pickup_label, dropoffLabel: item.dropoff_label,
      passengers: item.passengers.map(passengerProjection),
      events: item.events.map((entry) => ({ eventId: entry.event_id,
        sequence: entry.sequence, eventType: entry.event_type, clientId: entry.client_id,
        occurredAt: entry.occurred_at, note: entry.note,
        resolvesPairing: entry.resolves_pairing, actorUserId: entry.actor_user_id,
        actorDisplayName: entry.actor_display_name, contentHash: entry.content_hash,
        committedAt: entry.committed_at })), eventsTruncated: item.events_truncated,
      executionSequence: item.execution_sequence, status: item.status,
      actualStartedAt: item.actual_started_at,
      actualCompletedAt: item.actual_completed_at, lateSeconds: item.late_seconds,
      exceptionCount: item.exception_count,
      unmatchedPassengerCount: item.unmatched_passenger_count,
    })), matchingTripTotal: row.matching_trip_total,
    tripsTruncated: row.trips_truncated, pendingTotal: row.pending_total,
    inProgressTotal: row.in_progress_total, completedTotal: row.completed_total,
    lateTotal: row.late_total, unmatchedTripTotal: row.unmatched_trip_total,
    lateDefinition: row.late_definition, offlineStatus: row.offline_status,
    exportStatus: row.export_status, notificationStatus: row.notification_status,
    demo: input.demo };
}
