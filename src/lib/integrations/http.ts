import "server-only";

import { randomUUID } from "node:crypto";

import type { TenantContext } from "@/lib/domain/types";
import { fail } from "@/lib/api/response";
import { getTenantContext, hasRecentAal2 } from "@/lib/auth/context";
import {
  hasSupabaseAdminConfiguration,
  hasSupabaseConfiguration,
  isDemoMode,
} from "@/lib/env";

import { IntegrationError, isIntegrationError } from "./errors";

const DEFAULT_MAX_JSON_BYTES = 1024 * 1024;

export async function readJsonObject(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new IntegrationError(
      "REQUEST_TOO_LARGE",
      "操作內容超過允許大小。",
      413,
    );
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    throw new IntegrationError("INVALID_JSON", "無法讀取請求內容。", 400);
  }
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    throw new IntegrationError(
      "REQUEST_TOO_LARGE",
      "操作內容超過允許大小。",
      413,
    );
  }

  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not an object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new IntegrationError(
      "INVALID_JSON",
      "請提供有效的 JSON 物件。",
      400,
    );
  }
}

export async function authorizeStaffRequest(): Promise<TenantContext> {
  if (!isDemoMode() && !hasSupabaseConfiguration()) {
    throw new IntegrationError(
      "SERVICE_NOT_CONFIGURED",
      "正式資料服務尚未設定。",
      503,
    );
  }
  const actor = await getTenantContext("staff");
  if (!actor) {
    throw new IntegrationError("AUTH_REQUIRED", "請先登入。", 401);
  }
  if (!actor.demo && actor.assuranceLevel !== "aal2") {
    throw new IntegrationError(
      "AAL2_REQUIRED",
      "所有員工作業都必須先完成雙因素驗證。",
      403,
    );
  }
  if (!actor.branchId) {
    throw new IntegrationError(
      "BRANCH_CONTEXT_REQUIRED",
      "請先選擇作業分支。",
      409,
    );
  }
  return actor;
}

export async function requireRecentAal2(actor: TenantContext) {
  if (actor.demo) return;
  if (actor.assuranceLevel !== "aal2" || !(await hasRecentAal2())) {
    throw new IntegrationError(
      "AAL2_REQUIRED",
      "這項操作需要在最近 15 分鐘內重新完成雙因素驗證。",
      403,
    );
  }
}

export function requireAdminConfiguration() {
  if (!hasSupabaseAdminConfiguration()) {
    throw new IntegrationError(
      "SERVICE_NOT_CONFIGURED",
      "正式後端服務尚未完成安全設定。",
      503,
    );
  }
}

export async function handleIntegrationRoute(
  operation: (requestId: ReturnType<typeof randomUUID>) => Promise<Response>,
) {
  const requestId = randomUUID();
  try {
    return await operation(requestId);
  } catch (error) {
    if (isIntegrationError(error)) {
      return fail(
        error.httpStatus,
        {
          code: error.code,
          message: error.message,
          ...(error.field ? { field: error.field } : {}),
        },
        requestId,
      );
    }
    return fail(
      500,
      {
        code: "INTEGRATION_INTERNAL_ERROR",
        message: "操作失敗，資料未確認完成；請稍後重試並提供請求識別碼。",
      },
      requestId,
    );
  }
}

export function databaseFailure(
  code: string,
  message: string,
  httpStatus = 500,
) {
  return new IntegrationError(code, message, httpStatus);
}
