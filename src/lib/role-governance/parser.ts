import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  ROLE_GOVERNANCE_OPERATIONS,
  type RoleGovernanceApprovalApiData,
  type RoleGovernanceApprovalInput,
  type RoleGovernanceApprovalResult,
  type RoleGovernanceRequestApiData,
  type RoleGovernanceRequestInput,
  type RoleGovernanceRequestPayload,
  type RoleGovernanceRequestResult,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const roleKey = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/u);
const permissionKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/u);
const roleName = z.string().trim().min(1).max(120);
const roleDescription = z.string().trim().max(1_000).nullable();

const createRoleSchema = z.object({
  operation: z.literal("create_role"),
  role_key: roleKey,
  role_name: roleName,
  role_description: roleDescription,
}).strict();
const permissionSchema = z.object({
  operation: z.enum(["grant_permission", "revoke_permission"]),
  target_role_id: uuid,
  permission_key: permissionKey,
}).strict();
const assignmentSchema = z.object({
  operation: z.enum(["assign_role", "revoke_role"]),
  target_role_id: uuid,
  target_membership_id: uuid,
}).strict();
const deactivateSchema = z.object({
  operation: z.literal("deactivate_role"),
  target_role_id: uuid,
}).strict();
const roleRequestSchema = z.union([
  createRoleSchema,
  permissionSchema,
  assignmentSchema,
  deactivateSchema,
]);
const approvalSchema = z.object({ request_id: uuid }).strict();

const requestResultSchema = z.object({
  request_id: uuid,
  status: z.enum(["pending", "approved"]),
  replayed: z.boolean(),
}).strict();
const approvalResultSchema = z.object({
  request_id: uuid,
  status: z.literal("approved"),
  applied_at: z.string(),
  replayed: z.boolean(),
}).strict();

const apiErrorDetailSchema = z.object({
  code: z.string().min(1).max(120),
  message: z.string().min(1).max(500),
  field: z.string().min(1).max(120).optional(),
}).strict();
const errorEnvelopeSchema = z.object({
  requestId: uuid,
  status: z.literal("error"),
  data: z.null(),
  errors: z.array(apiErrorDetailSchema).min(1),
}).strict();
const requestApiDataSchema = z.object({
  governanceRequest: z.object({
    id: uuid,
    operation: z.enum(ROLE_GOVERNANCE_OPERATIONS),
    targetRoleId: uuid,
    targetMembershipId: uuid.nullable(),
    targetPermissionKey: permissionKey.nullable(),
    roleKey: roleKey.nullable(),
    roleName: roleName.nullable(),
    roleDescription: z.string().trim().max(1_000).nullable(),
    status: z.enum(["pending", "approved"]),
  }).strict(),
  replayed: z.boolean(),
  persisted: z.literal(true),
  demo: z.literal(false),
}).strict();
const requestSuccessEnvelopeSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: requestApiDataSchema,
  errors: z.array(z.never()).max(0),
}).strict();
const approvalApiDataSchema = z.object({
  governanceRequest: z.object({
    id: uuid,
    status: z.literal("approved"),
    appliedAt: z.string(),
  }).strict(),
  replayed: z.boolean(),
  persisted: z.literal(true),
  demo: z.literal(false),
}).strict();
const approvalSuccessEnvelopeSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: approvalApiDataSchema,
  errors: z.array(z.never()).max(0),
}).strict();

function parseIdempotencyKey(value: string | null) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) {
    throw new IntegrationError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "請在 Idempotency-Key 標頭提供有效的 UUID。",
      400,
      "idempotency_key",
    );
  }
  return parsed.data;
}

function invalidInput(message: string, result: z.ZodSafeParseError<unknown>): never {
  const issue = result.error.issues[0];
  throw new IntegrationError(
    "INVALID_ROLE_GOVERNANCE_REQUEST",
    message,
    400,
    issue?.path.length ? issue.path.join(".") : undefined,
  );
}

function invalidResult(): never {
  throw new IntegrationError(
    "ROLE_GOVERNANCE_RESULT_INVALID",
    "權限治理結果未完整確認；請保留相同冪等鍵重試。",
    409,
  );
}

function normalizedTimestamp(value: string) {
  if (!isStrictOffsetDateTime(value)) invalidResult();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalidResult();
  return parsed.toISOString();
}

export function parseRoleGovernanceRequest(
  value: unknown,
  headerIdempotencyKey: string | null,
): RoleGovernanceRequestInput {
  const parsed = roleRequestSchema.safeParse(value);
  if (!parsed.success) {
    invalidInput("角色變更申請欄位格式錯誤。", parsed);
  }
  const idempotencyKey = parseIdempotencyKey(headerIdempotencyKey);
  const data = parsed.data;
  if (data.operation === "create_role") {
    return {
      operation: data.operation,
      roleKey: data.role_key,
      roleName: data.role_name,
      roleDescription: data.role_description,
      idempotencyKey,
    };
  }
  if (
    data.operation === "grant_permission" ||
    data.operation === "revoke_permission"
  ) {
    return {
      operation: data.operation,
      targetRoleId: data.target_role_id,
      permissionKey: data.permission_key,
      idempotencyKey,
    };
  }
  if (data.operation === "assign_role" || data.operation === "revoke_role") {
    return {
      operation: data.operation,
      targetRoleId: data.target_role_id,
      targetMembershipId: data.target_membership_id,
      idempotencyKey,
    };
  }
  return {
    operation: data.operation,
    targetRoleId: data.target_role_id,
    idempotencyKey,
  };
}

export function parseRoleGovernanceApproval(
  value: unknown,
  headerIdempotencyKey: string | null,
): RoleGovernanceApprovalInput {
  const parsed = approvalSchema.safeParse(value);
  if (!parsed.success) invalidInput("角色變更核准欄位格式錯誤。", parsed);
  return {
    requestId: parsed.data.request_id,
    idempotencyKey: parseIdempotencyKey(headerIdempotencyKey),
  };
}

export function parseRoleGovernanceRequestResult(
  value: unknown,
): RoleGovernanceRequestResult {
  const parsed = requestResultSchema.safeParse(value);
  if (!parsed.success || (!parsed.data.replayed && parsed.data.status !== "pending")) {
    invalidResult();
  }
  return {
    requestId: parsed.data.request_id,
    status: parsed.data.status,
    replayed: parsed.data.replayed,
  };
}

export function parseRoleGovernanceApprovalResult(
  value: unknown,
  expectedRequestId: string,
): RoleGovernanceApprovalResult {
  const parsed = approvalResultSchema.safeParse(value);
  if (!parsed.success || parsed.data.request_id !== expectedRequestId.toLowerCase()) {
    invalidResult();
  }
  return {
    requestId: parsed.data.request_id,
    status: "approved",
    appliedAt: normalizedTimestamp(parsed.data.applied_at),
    replayed: parsed.data.replayed,
  };
}

function requestMatches(
  result: RoleGovernanceRequestApiData["governanceRequest"],
  expected: RoleGovernanceRequestPayload,
) {
  if (result.operation !== expected.operation) return false;
  if (expected.operation === "create_role") {
    return (
      result.targetMembershipId === null &&
      result.targetPermissionKey === null &&
      result.roleKey === expected.roleKey &&
      result.roleName === expected.roleName &&
      result.roleDescription === expected.roleDescription
    );
  }
  if (
    expected.operation === "grant_permission" ||
    expected.operation === "revoke_permission"
  ) {
    return (
      result.targetRoleId === expected.targetRoleId &&
      result.targetMembershipId === null &&
      result.targetPermissionKey === expected.permissionKey &&
      result.roleKey === null &&
      result.roleName === null &&
      result.roleDescription === null
    );
  }
  if (expected.operation === "assign_role" || expected.operation === "revoke_role") {
    return (
      result.targetRoleId === expected.targetRoleId &&
      result.targetMembershipId === expected.targetMembershipId &&
      result.targetPermissionKey === null &&
      result.roleKey === null &&
      result.roleName === null &&
      result.roleDescription === null
    );
  }
  return (
    result.targetRoleId === expected.targetRoleId &&
    result.targetMembershipId === null &&
    result.targetPermissionKey === null &&
    result.roleKey === null &&
    result.roleName === null &&
    result.roleDescription === null
  );
}

export function parseRoleGovernanceRequestSuccessEnvelope(
  value: unknown,
  expected: RoleGovernanceRequestPayload,
  httpStatus: number,
): RoleGovernanceRequestApiData {
  const parsed = requestSuccessEnvelopeSchema.safeParse(value);
  if (
    !parsed.success ||
    !requestMatches(parsed.data.data.governanceRequest, expected) ||
    (!parsed.data.data.replayed &&
      parsed.data.data.governanceRequest.status !== "pending") ||
    (parsed.data.data.replayed ? httpStatus !== 200 : httpStatus !== 201)
  ) {
    invalidResult();
  }
  return parsed.data.data;
}

export function parseRoleGovernanceApprovalSuccessEnvelope(
  value: unknown,
  expectedRequestId: string,
  httpStatus: number,
): RoleGovernanceApprovalApiData {
  const parsed = approvalSuccessEnvelopeSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.data.governanceRequest.id !== expectedRequestId.toLowerCase() ||
    httpStatus !== 200
  ) {
    invalidResult();
  }
  return {
    ...parsed.data.data,
    governanceRequest: {
      ...parsed.data.data.governanceRequest,
      appliedAt: normalizedTimestamp(parsed.data.data.governanceRequest.appliedAt),
    },
  };
}

export function roleGovernanceErrorMessage(value: unknown) {
  const parsed = errorEnvelopeSchema.safeParse(value);
  if (!parsed.success) return null;
  const message = parsed.data.errors[0]?.message;
  return message
    ? `${message}（請求識別碼：${parsed.data.requestId}）`
    : null;
}
