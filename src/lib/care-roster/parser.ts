import { z } from "zod";
import { IntegrationError } from "@/lib/integrations/errors";

const realDate = z.iso.date();
export const rosterInputSchema = z.object({
  clientId: z.uuid(), serviceDate: realDate, shift: z.enum(["morning", "afternoon"]),
  staffUserId: z.uuid().nullable(), expectedVersion: z.number().int().min(0),
  state: z.enum(["scheduled", "cancelled"]),
  sourceNote: z.string().trim().min(3).max(300).regex(/^[^\u0000-\u001f]*$/),
  tasks: z.array(z.enum(["temperature", "pulse", "blood_pressure", "oxygen_saturation", "care_diary"])).max(5),
  approved: z.literal(true), idempotency_key: z.uuid(),
}).strict().refine((v) => new Set(v.tasks).size === v.tasks.length, { message: "duplicate task" });
export type RosterInput = z.infer<typeof rosterInputSchema>;
export function parseRosterInput(raw: unknown): RosterInput {
  const parsed = rosterInputSchema.safeParse(raw);
  if (!parsed.success) throw new IntegrationError("INVALID_ROSTER", "請確認日期、班別、人員、工作項目與安排依據。", 400);
  return parsed.data;
}
