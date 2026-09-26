/** Node and Chrome can use different ICU literal spacing. Build the Taipei
 * display from date/time parts with fixed ASCII separators for exact hydration. */
export function formatBodyAssessmentTime(value: string) {
  if (!Number.isFinite(Date.parse(value))) return "時間尚未確認";
  const parts = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const field = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${field("year")}/${field("month")}/${field("day")} ${field("hour")}:${field("minute")}`;
}
