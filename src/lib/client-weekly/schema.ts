import { z } from "zod";

const note = z.string().trim().max(300).regex(/^[^\u0000-\u001f]*$/);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const transportNeedSchema = z.object({
  location: note.min(1), windowStart: time, windowEnd: time,
  wheelchair: z.boolean(), contact: note.min(1),
}).strict().refine((v) => v.windowStart <= v.windowEnd, "接送時間窗先後不正確");
export const daySchema = z.object({
  weekday: z.number().int().min(1).max(7), attending: z.boolean(),
  startsAt: time.nullable(), endsAt: time.nullable(),
  outbound: transportNeedSchema.nullable(), inbound: transportNeedSchema.nullable(),
}).strict().superRefine((v, ctx) => {
  if (v.attending && (!v.startsAt || !v.endsAt || v.startsAt >= v.endsAt)) ctx.addIssue({ code: "custom", message: "到站時間須早於離站時間" });
  if (!v.attending && (v.startsAt !== null || v.endsAt !== null || v.outbound !== null || v.inbound !== null)) ctx.addIssue({ code: "custom", message: "未到站日不得建立時段或接送需求" });
  if (v.attending && v.outbound && v.startsAt && v.outbound.windowEnd > v.startsAt) ctx.addIssue({ code: "custom", message: "去程時間窗須在到站時間之前" });
  if (v.attending && v.inbound && v.endsAt && v.inbound.windowStart < v.endsAt) ctx.addIssue({ code: "custom", message: "回程時間窗須在離站時間之後" });
});
export const planSchema = z.object({
  effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().nullable(),
  days: z.array(daySchema).length(7), reason: note.min(3),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.days.map((d) => d.weekday)).size !== 7) ctx.addIssue({ code: "custom", message: "星期不可重複" });
  if (v.effectiveTo && v.effectiveFrom > v.effectiveTo) ctx.addIssue({ code: "custom", message: "生效日期先後不正確" });
});
const base = { clientId: z.uuid(), expectedVersion: z.number().int().min(0).max(1000000), idempotency_key: z.uuid() };
export const weeklyInputSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("save_plan"), plan: planSchema }).strict(),
  z.object({ ...base, action: z.literal("save_exception"), serviceDate: z.iso.date(), day: daySchema, reason: note.min(3) }).strict()
    .refine((v) => weekdayOf(v.serviceDate) === v.day.weekday, "日期與星期不一致"),
]);
export type TransportNeed = z.infer<typeof transportNeedSchema>;
export type WeeklyDay = z.infer<typeof daySchema>;
export type WeeklyPlan = z.infer<typeof planSchema>;
export type WeeklyInput = z.infer<typeof weeklyInputSchema>;
export const storedPlanSchema = planSchema.safeExtend({ id: z.uuid(), version: z.number().int().positive() });
export const exceptionSchema = z.object({ serviceDate: z.iso.date(), day: daySchema, reason: note, version: z.number().int().positive() });
export const projectedDaySchema = z.object({
  date: z.iso.date(), status: z.enum(["scheduled", "not_scheduled", "cancelled", "inactive", "not_admitted", "plan_expired"]),
  day: daySchema.nullable(), planVersion: z.number().int().nonnegative(), exceptionVersion: z.number().int().nonnegative(),
  transportStatus: z.literal("unassigned_demand"),
});
export const weeklySnapshotSchema = z.object({
  clientId: z.uuid(), from: z.iso.date(), generatedAt: z.iso.datetime({ offset: true }),
  version: z.number().int().nonnegative(), plan: storedPlanSchema.nullable(),
  exceptions: z.array(exceptionSchema).max(28), days: z.array(projectedDaySchema).length(28),
}).refine((value) => value.plan ? value.plan.version === value.version : value.version === 0, "週表與讀回版本不一致");
export type WeeklySnapshot = z.infer<typeof weeklySnapshotSchema>;
export type ProjectedDay = z.infer<typeof projectedDaySchema>;
export const weeklyReceiptSchema = z.object({ id: z.uuid(), clientId: z.uuid(), action: z.enum(["save_plan", "save_exception"]), version: z.number().int().positive(), replayed: z.boolean(), persisted: z.literal(true) });

export function weekdayOf(date: string): number { return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1; }
export function addDays(date: string, offset: number): string { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); }
export function emptyDay(weekday: number): WeeklyDay { return { weekday, attending: false, startsAt: null, endsAt: null, outbound: null, inbound: null }; }
export function emptyPlan(today: string): WeeklyPlan { return { effectiveFrom: today, effectiveTo: null, days: Array.from({ length: 7 }, (_, i) => emptyDay(i + 1)), reason: "" }; }

/** Draft preview only. Server projection is authoritative for saved work lists. */
export function previewWeeklyPlan(plan: WeeklyPlan, from: string): ProjectedDay[] {
  return Array.from({ length: 28 }, (_, offset) => {
    const date = addDays(from, offset);
    const applicable = date >= plan.effectiveFrom && (!plan.effectiveTo || date <= plan.effectiveTo);
    const day = applicable ? plan.days.find((d) => d.weekday === weekdayOf(date)) ?? null : null;
    return { date, status: !applicable ? "plan_expired" : day?.attending ? "scheduled" : "not_scheduled", day,
      planVersion: 0, exceptionVersion: 0, transportStatus: "unassigned_demand" };
  });
}
