import type { CareDiaryFields } from "./schema";

const taipeiHour = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Taipei", hour: "2-digit", hourCycle: "h23",
});

/** A shift describes when care happened, not when a late entry was typed. */
export function isDiaryShiftTimeAligned(shift: CareDiaryFields["shift"], occurredAt: string): boolean {
  const instant = new Date(occurredAt);
  if (!Number.isFinite(instant.getTime())) return false;
  if (shift === "full_day") return true;
  if (shift !== "morning" && shift !== "afternoon") return false;
  const hour = Number(taipeiHour.format(instant));
  return shift === "morning" ? hour < 12 : hour >= 12;
}
