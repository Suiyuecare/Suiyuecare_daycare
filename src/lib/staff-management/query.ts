import {
  STAFF_MANAGEMENT_QUALIFICATION_FILTERS,
  STAFF_MANAGEMENT_STATUS_FILTERS,
  type StaffManagementFilters,
  type StaffManagementQualificationFilter,
  type StaffManagementStatusFilter,
} from "./types";

type SearchValues = Record<string, string | string[] | undefined>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const allowedKeys = new Set(["status", "role", "qualification", "q"]);

function scalar(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export function parseStaffManagementFilters(values: SearchValues): {
  filters: StaffManagementFilters;
  invalid: boolean;
} {
  const requestedStatus = scalar(values.status) ?? "all";
  const requestedRole = scalar(values.role) ?? "all";
  const requestedQualification = scalar(values.qualification) ?? "all";
  const requestedQuery = scalar(values.q) ?? "";

  const statusValid = STAFF_MANAGEMENT_STATUS_FILTERS.includes(
    requestedStatus as StaffManagementStatusFilter,
  );
  const roleValid = requestedRole === "all" || uuidPattern.test(requestedRole);
  const qualificationValid = STAFF_MANAGEMENT_QUALIFICATION_FILTERS.includes(
    requestedQualification as StaffManagementQualificationFilter,
  );
  const queryValid = requestedQuery.length <= 120 &&
    !/[\u0000-\u001f\u007f]/u.test(requestedQuery);
  const scalarValues = [values.status, values.role, values.qualification, values.q]
    .every((value) => value === undefined || typeof value === "string");
  const keysValid = Object.keys(values).every((key) => allowedKeys.has(key));

  return {
    filters: {
      status: statusValid
        ? requestedStatus as StaffManagementStatusFilter
        : "all",
      roleId: roleValid && requestedRole !== "all"
        ? requestedRole.toLowerCase()
        : null,
      qualification: qualificationValid
        ? requestedQualification as StaffManagementQualificationFilter
        : "all",
      query: queryValid ? requestedQuery.trim() : "",
    },
    invalid: !statusValid || !roleValid || !qualificationValid || !queryValid ||
      !scalarValues || !keysValid,
  };
}
