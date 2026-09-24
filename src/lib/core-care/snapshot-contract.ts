import { z } from "zod";
import { projectDailyCareSnapshot } from "./projection";
import type { DailyCareSnapshot } from "./types";

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const access = z.object({ attendance: z.boolean(), measurements: z.boolean(), careDiaries: z.boolean(), serviceEvents: z.boolean() }).strict();
const contract = z.object({
  organizationId: uuid, branchId: uuid, serviceDate: z.iso.date(), generatedAt: timestamp,
  clients: z.array(z.object({ id: uuid, client_code: z.string(), display_name: z.string(),
    eligibility: z.enum(["eligible", "inactive", "not_admitted"]), scheduleStatus: z.enum(["scheduled", "not_scheduled", "unknown", "ineligible"]), sourceAccess: access }).strict()).max(500),
  attendance: z.array(z.object({ id: uuid, client_id: uuid, status: z.enum(["present", "absent", "leave"]), checked_in_at: timestamp.nullable(), checked_out_at: timestamp.nullable(), source: z.string() }).strict()).max(500),
  measurements: z.array(z.object({ client_id: uuid, measurement_kind: z.enum(["blood_pressure_systolic", "blood_pressure_diastolic", "pulse", "temperature", "oxygen_saturation"]), measured_at: timestamp, numeric_value: z.union([z.number().finite(), z.string().regex(/^-?\d+(?:\.\d+)?$/)]).nullable() }).strict()).max(2500),
  careDiaries: z.array(z.object({ id: uuid, record_key: uuid, version: z.number().int().positive(), client_id: uuid, status: z.enum(["draft", "submitted", "signed", "corrected"]), occurred_at: timestamp, data: z.object({ abnormal: z.boolean(), has_abnormal_flag: z.boolean() }).strict() }).strict()).max(500),
  serviceEvents: z.array(z.object({ client_id: uuid, status: z.literal("completed"), count: z.number().int().nonnegative() }).strict()).max(500),
}).strict();

export function parseCoreDailySnapshot(raw: unknown, expected: { organizationId: string; branchId: string; serviceDate: string }, sourceAccess: DailyCareSnapshot["sourceAccess"]): DailyCareSnapshot {
  const row = contract.parse(raw);
  if (row.organizationId !== expected.organizationId || row.branchId !== expected.branchId || row.serviceDate !== expected.serviceDate) throw new Error("CORE_DAILY_SCOPE_MISMATCH");
  const clients = new Map(row.clients.map(client => [client.id, client]));
  if (clients.size !== row.clients.length) throw new Error("CORE_DAILY_DUPLICATE_CLIENT");
  for (const [key, rows] of [["attendance", row.attendance], ["measurements", row.measurements], ["careDiaries", row.careDiaries], ["serviceEvents", row.serviceEvents]] as const) {
    const seen = new Set<string>();
    for (const item of rows) {
      const client = clients.get(item.client_id);
      const identity = key === "measurements" ? `${item.client_id}:${"measurement_kind" in item ? item.measurement_kind : ""}` : item.client_id;
      if (!client?.sourceAccess[key] || seen.has(identity)) throw new Error("CORE_DAILY_SOURCE_MISMATCH");
      seen.add(identity);
    }
  }
  // Server scope and each client's source authorization must both permit a source.
  return projectDailyCareSnapshot({ ...row, sourceAccess,
    clients: row.clients.map(client => ({ ...client, sourceAccess: {
      attendance: sourceAccess.attendance && client.sourceAccess.attendance,
      measurements: sourceAccess.measurements && client.sourceAccess.measurements,
      careDiaries: sourceAccess.careDiaries && client.sourceAccess.careDiaries,
      serviceEvents: sourceAccess.serviceEvents && client.sourceAccess.serviceEvents,
    } })),
    attendance: sourceAccess.attendance ? row.attendance : [], measurements: sourceAccess.measurements ? row.measurements : [],
    careDiaries: sourceAccess.careDiaries ? row.careDiaries : [], serviceEvents: sourceAccess.serviceEvents ? row.serviceEvents : [],
  });
}
