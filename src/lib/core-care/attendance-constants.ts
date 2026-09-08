export const ATTENDANCE_EVENT_KINDS = [
  "check_in", "check_out", "absent", "leave",
] as const;

export type AttendanceEventKind = (typeof ATTENDANCE_EVENT_KINDS)[number];
