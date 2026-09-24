import { z } from "zod";
import type { DailyExpectedState, ExpectedClient } from "./daily-projection";

const directionSchema = z.enum(["pickup", "dropoff"]);
const dispatchRowSchema = z.object({
  clientId: z.uuid(), direction: directionSchema,
  status: z.enum(["pending", "assigned", "conflict", "restricted"]),
  tripVersionIds: z.array(z.uuid()).max(1000),
}).strict();
const sourceDispatchSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("forbidden") }).strict(),
  z.object({ status: z.literal("ready"), rows: z.array(dispatchRowSchema).max(1000) }).strict(),
]);
export type DispatchRow = z.infer<typeof dispatchRowSchema>;
export type DailyDispatchReconciliation =
  | { status: "forbidden" }
  | { status: "ready"; rows: DispatchRow[]; pendingCount: number; assignedCount: number;
    conflictCount: number; restrictedCount: number };

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const sourceSchema = z.object({
  organizationId: z.uuid(), branchId: z.uuid(), serviceDate: z.iso.date(),
  generatedAt: z.iso.datetime({ offset: true }), evidenceKind: z.literal("planned_not_attended"),
  clients: z.array(z.object({ clientId: z.uuid(), startsAt: time, endsAt: time,
    outbound: z.boolean(), inbound: z.boolean() }).strict()).max(500),
  dispatch: sourceDispatchSchema,
}).strict();

/** The single RPC snapshot contains no addresses, contacts, diagnoses or driver data. */
export function projectDailyTransportReconciliation(
  raw: unknown,
  scope: { organizationId: string; branchId: string; serviceDate: string },
  names: ReadonlyMap<string, string>,
): Extract<DailyExpectedState, { status: "ready" }> {
  const invalid = () => { throw new Error("DAILY_TRANSPORT_SNAPSHOT_INVALID"); };
  const parsed = sourceSchema.safeParse(raw);
  if (!parsed.success) return invalid();
  const source = parsed.data;
  if (source.organizationId !== scope.organizationId || source.branchId !== scope.branchId
    || source.serviceDate !== scope.serviceDate) return invalid();

  const expected = new Set<string>();
  const ids = new Set<string>();
  const clients: ExpectedClient[] = source.clients.map((client) => {
    if (ids.has(client.clientId) || client.startsAt >= client.endsAt) return invalid();
    ids.add(client.clientId);
    // Weekly outbound = travel to the centre; inbound = return home.
    if (client.outbound) expected.add(`${client.clientId}:pickup`);
    if (client.inbound) expected.add(`${client.clientId}:dropoff`);
    return { ...client, displayName: names.get(client.clientId) || `個案（編號末 ${client.clientId.slice(-4)}）` };
  }).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.clientId.localeCompare(b.clientId));

  let dispatch: DailyDispatchReconciliation = { status: "forbidden" };
  if (source.dispatch.status === "ready") {
    const seen = new Set<string>();
    const tripDirections = new Map<string, DispatchRow["direction"]>();
    for (const row of source.dispatch.rows) {
      const key = `${row.clientId}:${row.direction}`;
      if (!expected.has(key) || seen.has(key)) return invalid();
      seen.add(key);
      const count = row.tripVersionIds.length;
      if (new Set(row.tripVersionIds).size !== count
        || (row.status === "pending" && count !== 0)
        || (row.status === "assigned" && count !== 1)
        || (row.status === "conflict" && count < 2)
        || (row.status === "restricted" && count !== 0)) return invalid();
      for (const tripId of row.tripVersionIds) {
        if (tripDirections.has(tripId) && tripDirections.get(tripId) !== row.direction) return invalid();
        tripDirections.set(tripId, row.direction);
      }
    }
    if (seen.size !== expected.size) return invalid();
    const rows = [...source.dispatch.rows].sort((a, b) => a.clientId.localeCompare(b.clientId) || a.direction.localeCompare(b.direction));
    dispatch = { status: "ready", rows,
      pendingCount: rows.filter((row) => row.status === "pending").length,
      assignedCount: rows.filter((row) => row.status === "assigned").length,
      conflictCount: rows.filter((row) => row.status === "conflict").length,
      restrictedCount: rows.filter((row) => row.status === "restricted").length };
  }
  return { status: "ready", serviceDate: source.serviceDate, generatedAt: source.generatedAt, clients,
    expectedCount: clients.length, transportClientCount: clients.filter((client) => client.outbound || client.inbound).length,
    outboundCount: clients.filter((client) => client.outbound).length,
    inboundCount: clients.filter((client) => client.inbound).length, dispatch };
}
