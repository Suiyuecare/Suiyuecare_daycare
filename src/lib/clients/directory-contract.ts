import type { ClientLifecycleStatus } from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CLIENT_STATUSES = new Set<ClientLifecycleStatus>([
  "active",
  "suspended",
  "transferred",
  "closed",
  "deceased",
]);
const RPC_KEYS = new Set([
  "client_id",
  "organization_id",
  "branch_id",
  "client_code",
  "display_name",
  "status",
  "admitted_on",
  "ended_on",
  "row_version",
  "updated_at",
  "visible_count",
  "has_more",
]);

export const CLIENT_DIRECTORY_PURPOSES = Object.freeze([
  "case_center",
  "core_daily",
  "blood_glucose",
  "client_registry",
  "client_lifecycle",
  "care_plans",
  "service_usage",
  "offline_sync",
  "medication_plan",
] as const);

export type ClientDirectoryPurpose =
  (typeof CLIENT_DIRECTORY_PURPOSES)[number];

export type ClientDirectoryRow = {
  id: string;
  organization_id: string;
  branch_id: string;
  client_code: string;
  display_name: string;
  status: ClientLifecycleStatus;
  admitted_on: string | null;
  ended_on: string | null;
  row_version: number;
  updated_at: string;
};

export type ClientDirectoryPage = {
  rows: readonly ClientDirectoryRow[];
  visibleCount: number;
  hasMore: boolean;
};

export class ClientDirectoryContractError extends Error {
  constructor() {
    super("CLIENT_DIRECTORY_CONTRACT_INVALID");
    this.name = "ClientDirectoryContractError";
  }
}

function invalid(): never {
  throw new ClientDirectoryContractError();
}

function uuid(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value.toLowerCase();
}

function text(value: unknown, max: number) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    invalid();
  }
  return value;
}

function calendarDate(value: unknown) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) invalid();
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    invalid();
  }
  return value;
}

function optionalDate(value: unknown) {
  return value === null ? null : calendarDate(value);
}

function timestamp(value: unknown) {
  if (typeof value !== "string") invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalid();
  return parsed.toISOString();
}

function safeCount(value: unknown) {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || Number(numeric) < 0) invalid();
  return Number(numeric);
}

export function parseClientDirectoryPage(input: {
  value: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  pageSize: number;
}): ClientDirectoryPage {
  const organizationId = uuid(input.expectedOrganizationId);
  const branchId = uuid(input.expectedBranchId);
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 200) {
    invalid();
  }
  if (!Array.isArray(input.value)) invalid();
  if (input.value.length === 0) {
    return { rows: [], visibleCount: 0, hasMore: false };
  }
  if (input.value.length > input.pageSize) invalid();

  let visibleCount: number | null = null;
  let hasMore: boolean | null = null;
  const ids = new Set<string>();
  const rows = input.value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
    const record = raw as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== RPC_KEYS.size || keys.some((key) => !RPC_KEYS.has(key))) {
      invalid();
    }
    const id = uuid(record.client_id);
    if (
      uuid(record.organization_id) !== organizationId ||
      uuid(record.branch_id) !== branchId ||
      ids.has(id)
    ) {
      invalid();
    }
    ids.add(id);
    const status = record.status;
    if (typeof status !== "string" || !CLIENT_STATUSES.has(status as ClientLifecycleStatus)) {
      invalid();
    }
    const admittedOn = optionalDate(record.admitted_on);
    const endedOn = optionalDate(record.ended_on);
    if (admittedOn && endedOn && endedOn < admittedOn) invalid();
    const rowVersion = safeCount(record.row_version);
    if (rowVersion < 1) invalid();
    const rowVisibleCount = safeCount(record.visible_count);
    if (typeof record.has_more !== "boolean") invalid();
    visibleCount ??= rowVisibleCount;
    hasMore ??= record.has_more;
    if (visibleCount !== rowVisibleCount || hasMore !== record.has_more) invalid();
    return {
      id,
      organization_id: organizationId,
      branch_id: branchId,
      client_code: text(record.client_code, 64),
      display_name: text(record.display_name, 120),
      status: status as ClientLifecycleStatus,
      admitted_on: admittedOn,
      ended_on: endedOn,
      row_version: rowVersion,
      updated_at: timestamp(record.updated_at),
    };
  });

  if (
    visibleCount === null ||
    hasMore === null ||
    visibleCount < rows.length ||
    (hasMore &&
      (rows.length !== input.pageSize || visibleCount <= rows.length))
  ) {
    invalid();
  }
  return { rows, visibleCount, hasMore };
}
