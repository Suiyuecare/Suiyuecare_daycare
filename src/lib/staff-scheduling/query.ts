import {
  addStaffSchedulingDays,
  isStaffSchedulingDate,
  staffSchedulingRangeDays,
  staffSchedulingTaipeiDate,
} from "./date";
import {
  STAFF_SCHEDULING_STATUS_FILTERS,
  type StaffSchedulingFilters,
  type StaffSchedulingStatusFilter,
} from "./types";

type SearchValues = Record<string, string | string[] | undefined>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEYS = new Set(["from", "to", "staff", "status"]);

function scalar(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export function parseStaffSchedulingFilters(values: SearchValues, now = new Date()): {
  filters: StaffSchedulingFilters;
  invalid: boolean;
} {
  const today = staffSchedulingTaipeiDate(now);
  const requestedStart = scalar(values.from) ?? today;
  const requestedEnd = scalar(values.to) ?? addStaffSchedulingDays(today, 6);
  const requestedStaff = scalar(values.staff) ?? "all";
  const requestedStatus = scalar(values.status) ?? "all";
  const startValid = isStaffSchedulingDate(requestedStart);
  const endValid = isStaffSchedulingDate(requestedEnd);
  const rangeValid = startValid && endValid && requestedStart <= requestedEnd &&
    staffSchedulingRangeDays(requestedStart, requestedEnd) <= 63;
  const staffValid = requestedStaff === "all" || UUID.test(requestedStaff);
  const statusValid = STAFF_SCHEDULING_STATUS_FILTERS.includes(
    requestedStatus as StaffSchedulingStatusFilter,
  );
  const scalarValid = [values.from, values.to, values.staff, values.status]
    .every((value) => value === undefined || typeof value === "string");
  const keysValid = Object.keys(values).every((key) => KEYS.has(key));
  return {
    filters: {
      periodStart: rangeValid ? requestedStart : today,
      periodEnd: rangeValid ? requestedEnd : addStaffSchedulingDays(today, 6),
      staffMembershipId: staffValid && requestedStaff !== "all"
        ? requestedStaff.toLowerCase() : null,
      status: statusValid ? requestedStatus as StaffSchedulingStatusFilter : "all",
    },
    invalid: !rangeValid || !staffValid || !statusValid || !scalarValid || !keysValid,
  };
}
