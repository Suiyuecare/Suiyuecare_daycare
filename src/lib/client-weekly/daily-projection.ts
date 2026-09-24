import { z } from "zod";
import { projectedDaySchema } from "./schema";
import type { DailyDispatchReconciliation } from "./dispatch-reconciliation";

const projectionSchema = z.object({
  serviceDate: z.iso.date(), generatedAt: z.iso.datetime({ offset: true }),
  evidenceKind: z.literal("planned_not_attended"), transportStatus: z.literal("unassigned_demand"),
  rows: z.array(z.object({ clientId: z.uuid(), day: projectedDaySchema })).max(500),
});

export type ExpectedClient = {
  clientId: string; displayName: string; startsAt: string; endsAt: string;
  outbound: boolean; inbound: boolean;
};
export type DailyExpectedState =
  | { status: "forbidden" | "unavailable" | "demo"; serviceDate: string }
  | {
    status: "ready"; serviceDate: string; generatedAt: string; clients: ExpectedClient[];
    expectedCount: number; transportClientCount: number; outboundCount: number; inboundCount: number;
    dispatch: DailyDispatchReconciliation;
  };

/** Only a minimum projection leaves the server: never transport addresses/contacts. */
export function projectDailyExpectedClients(
  raw: unknown, serviceDate: string, names: ReadonlyMap<string, string>,
): Extract<DailyExpectedState, { status: "ready" }> {
  const result = projectionSchema.safeParse(raw);
  if (!result.success || result.data.serviceDate !== serviceDate) throw new Error("WEEKLY_PROJECTION_INVALID");
  const seen = new Set<string>();
  const clients: ExpectedClient[] = [];
  for (const row of result.data.rows) {
    if (seen.has(row.clientId) || row.day.date !== serviceDate) throw new Error("WEEKLY_PROJECTION_INVALID");
    seen.add(row.clientId);
    if (row.day.status !== "scheduled") continue;
    const day = row.day.day;
    if (!day?.attending || !day.startsAt || !day.endsAt) throw new Error("WEEKLY_PROJECTION_INVALID");
    clients.push({
      clientId: row.clientId,
      displayName: names.get(row.clientId) || `個案（編號末 ${row.clientId.slice(-4)}）`,
      startsAt: day.startsAt, endsAt: day.endsAt, outbound: day.outbound !== null, inbound: day.inbound !== null,
    });
  }
  clients.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.clientId.localeCompare(b.clientId));
  return {
    status: "ready", serviceDate, generatedAt: result.data.generatedAt, clients,
    expectedCount: clients.length,
    transportClientCount: clients.filter((row) => row.outbound || row.inbound).length,
    outboundCount: clients.filter((row) => row.outbound).length,
    inboundCount: clients.filter((row) => row.inbound).length,
    // A legacy weekly-only projection is never evidence that no trip is assigned.
    dispatch: { status: "forbidden" },
  };
}
