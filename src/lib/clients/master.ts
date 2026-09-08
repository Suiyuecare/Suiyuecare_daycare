import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import type {
  ClientMasterItem,
  ClientMasterOperationResult,
  ClientMasterSnapshot,
  ClientMasterStatusFilter,
  CreateLocalClientInput,
  UpdateLocalClientInput,
} from "./master-types";
import type { ClientLifecycleStatus } from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CLIENT_STATUSES = [
  "active",
  "suspended",
  "transferred",
  "closed",
  "deceased",
] as const;

const localFields = {
  client_code: z.string().trim().min(1).max(64),
  display_name: z.string().trim().min(1).max(120),
  date_of_birth: z.string().regex(DATE_PATTERN).nullable(),
};

const createSchema = z.object(localFields).strict();
const updateSchema = z
  .object({
    client_id: z.uuid(),
    ...localFields,
    expected_row_version: z.number().int().positive().safe(),
  })
  .strict();
const resultSchema = z
  .object({
    operation_id: z.uuid(),
    client_id: z.uuid(),
    row_version: z.number().int().positive().safe(),
    replayed: z.boolean(),
  })
  .strict();

export type ClientMasterSourceRow = {
  id: string;
  organization_id: string;
  branch_id: string;
  client_code: string;
  display_name: string;
  date_of_birth: string | null;
  status: string;
  admitted_on: string | null;
  ended_on: string | null;
  source_system: string;
  source_updated_at: string | null;
  row_version: number;
  updated_at: string;
};

function invalidProjection(): never {
  throw new Error("INVALID_CLIENT_MASTER_PROJECTION");
}

function uuid(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    invalidProjection();
  }
  return value.toLowerCase();
}

function text(value: unknown, max: number) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    invalidProjection();
  }
  return value.trim();
}

function calendarDate(value: unknown): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    invalidProjection();
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    invalidProjection();
  }
  return value;
}

function optionalDate(value: unknown) {
  return value === null ? null : calendarDate(value);
}

function timestamp(value: unknown) {
  if (typeof value !== "string") invalidProjection();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalidProjection();
  return parsed.toISOString();
}

function optionalTimestamp(value: unknown) {
  return value === null ? null : timestamp(value);
}

function clientInputError(
  code: string,
  result: z.ZodSafeParseError<unknown>,
): never {
  const issue = result.error.issues[0];
  throw new IntegrationError(
    code,
    "個案主檔欄位格式錯誤；僅接受個案代碼、顯示姓名與出生日期。",
    400,
    issue?.path.length ? issue.path.join(".") : undefined,
  );
}

function parseIdempotencyKey(value: string | null) {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) {
    throw new IntegrationError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "請在 Idempotency-Key 標頭提供有效的 UUID。",
      400,
      "idempotency_key",
    );
  }
  return parsed.data.toLowerCase();
}

function validBirthDate(value: string | null, now: Date) {
  if (value === null) return null;
  let date: string;
  try {
    date = calendarDate(value);
  } catch {
    throw new IntegrationError(
      "INVALID_DATE_OF_BIRTH",
      "出生日期不是有效日期。",
      400,
      "date_of_birth",
    );
  }
  const taipeiToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  if (date < "1900-01-01" || date > taipeiToday) {
    throw new IntegrationError(
      "INVALID_DATE_OF_BIRTH",
      "出生日期必須介於 1900-01-01 與台北今日之間。",
      400,
      "date_of_birth",
    );
  }
  return date;
}

export function parseCreateLocalClient(
  value: unknown,
  headerIdempotencyKey: string | null,
  now = new Date(),
): CreateLocalClientInput {
  const parsed = createSchema.safeParse(value);
  if (!parsed.success) clientInputError("INVALID_CLIENT_CREATE", parsed);
  return {
    clientCode: parsed.data.client_code,
    displayName: parsed.data.display_name,
    dateOfBirth: validBirthDate(parsed.data.date_of_birth, now),
    idempotencyKey: parseIdempotencyKey(headerIdempotencyKey),
  };
}

export function parseUpdateLocalClient(
  value: unknown,
  headerIdempotencyKey: string | null,
  now = new Date(),
): UpdateLocalClientInput {
  const parsed = updateSchema.safeParse(value);
  if (!parsed.success) clientInputError("INVALID_CLIENT_UPDATE", parsed);
  return {
    clientId: parsed.data.client_id.toLowerCase(),
    clientCode: parsed.data.client_code,
    displayName: parsed.data.display_name,
    dateOfBirth: validBirthDate(parsed.data.date_of_birth, now),
    expectedRowVersion: parsed.data.expected_row_version,
    idempotencyKey: parseIdempotencyKey(headerIdempotencyKey),
  };
}

export function parseClientMasterOperationResult(
  value: unknown,
  expectedClientId?: string,
): ClientMasterOperationResult {
  const parsed = resultSchema.safeParse(value);
  if (
    !parsed.success ||
    (expectedClientId &&
      parsed.data.client_id.toLowerCase() !== expectedClientId.toLowerCase())
  ) {
    throw new IntegrationError(
      "CLIENT_MASTER_RESULT_INVALID",
      "個案主檔結果未完整確認；請保留內容並以相同冪等鍵重試。",
      409,
    );
  }
  return {
    operationId: parsed.data.operation_id.toLowerCase(),
    clientId: parsed.data.client_id.toLowerCase(),
    rowVersion: parsed.data.row_version,
    replayed: parsed.data.replayed,
  };
}

export function hasClientMasterWriteAuthority(
  scopes: readonly string[],
  operation: "create" | "update",
) {
  return (
    scopes.includes("clients.read") &&
    scopes.includes("clients.manage") &&
    scopes.includes("clients.demographics.read") &&
    (operation === "update" || scopes.includes("clients.view_all"))
  );
}

export function projectClientMasterSnapshot(input: {
  rows: readonly ClientMasterSourceRow[];
  expectedOrganizationId: string;
  expectedBranchId: string;
  generatedAt: string;
  demo: boolean;
  demographicsReadable?: boolean;
}): ClientMasterSnapshot {
  const organizationId = uuid(input.expectedOrganizationId);
  const branchId = uuid(input.expectedBranchId);
  const generatedAt = timestamp(input.generatedAt);
  const ids = new Set<string>();
  const codes = new Set<string>();
  const clients: ClientMasterItem[] = input.rows.map((row) => {
    const id = uuid(row.id);
    const rowOrganizationId = uuid(row.organization_id);
    const rowBranchId = uuid(row.branch_id);
    const clientCode = text(row.client_code, 64);
    const displayName = text(row.display_name, 120);
    if (
      rowOrganizationId !== organizationId ||
      rowBranchId !== branchId ||
      ids.has(id) ||
      codes.has(clientCode) ||
      !CLIENT_STATUSES.includes(row.status as ClientLifecycleStatus) ||
      !Number.isSafeInteger(row.row_version) ||
      row.row_version < 1
    ) {
      invalidProjection();
    }
    ids.add(id);
    codes.add(clientCode);
    const status = row.status as ClientLifecycleStatus;
    const sourceSystem = text(row.source_system, 64);
    if (row.source_system !== sourceSystem) invalidProjection();
    const sourceAuthority = sourceSystem === "local" ? "local" : "central";
    const terminal = ["transferred", "closed", "deceased"].includes(status);
    const admittedOn = optionalDate(row.admitted_on);
    const endedOn = optionalDate(row.ended_on);
    if ((terminal && endedOn === null) || (endedOn && admittedOn && endedOn < admittedOn)) {
      invalidProjection();
    }
    const dateOfBirth = optionalDate(row.date_of_birth);
    if (input.demographicsReadable === false && dateOfBirth !== null) {
      invalidProjection();
    }
    return {
      id,
      clientCode,
      displayName,
      dateOfBirth,
      status,
      serviceState:
        status === "active" && admittedOn === null
          ? "pending_admission"
          : status,
      admittedOn,
      endedOn,
      sourceSystem,
      sourceAuthority,
      sourceUpdatedAt: optionalTimestamp(row.source_updated_at),
      rowVersion: row.row_version,
      updatedAt: timestamp(row.updated_at),
      editable: sourceAuthority === "local" && !terminal,
      editBlockReason:
        sourceAuthority === "central"
          ? "central_authority"
          : terminal
            ? "terminal_status"
            : null,
    };
  });

  return {
    generatedAt,
    clients,
    metrics: {
      active: clients.filter((client) => client.serviceState === "active").length,
      pendingAdmission: clients.filter(
        (client) => client.serviceState === "pending_admission",
      ).length,
      localEditable: clients.filter((client) => client.editable).length,
      centralAuthority: clients.filter(
        (client) => client.sourceAuthority === "central",
      ).length,
      terminal: clients.filter((client) =>
        ["transferred", "closed", "deceased"].includes(client.status),
      ).length,
    },
    demographicsReadable: input.demographicsReadable ?? true,
    demo: input.demo,
  };
}

export function filterClientMasterItems(
  snapshot: ClientMasterSnapshot,
  options: {
    query: string;
    status: ClientMasterStatusFilter;
    source: "all" | "central" | "local";
  },
) {
  const query = options.query.trim().toLocaleLowerCase("zh-TW");
  return snapshot.clients.filter((client) => {
    const matchesQuery =
      !query ||
      `${client.clientCode} ${client.displayName}`
        .toLocaleLowerCase("zh-TW")
        .includes(query);
    return (
      matchesQuery &&
      (options.status === "all" || client.serviceState === options.status) &&
      (options.source === "all" || client.sourceAuthority === options.source)
    );
  });
}
