import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import type { ApiEnvelope, ApiErrorDetail } from "@/lib/domain/types";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export function ok<T>(data: T, status = 200, requestId = randomUUID()) {
  const body: ApiEnvelope<T> = {
    requestId,
    status: "ok",
    data,
    errors: [],
  };

  return NextResponse.json(body, { status, headers: privateHeaders });
}

export function partial<T>(
  data: T,
  errors: ApiErrorDetail[],
  status = 207,
  requestId = randomUUID(),
) {
  const body: ApiEnvelope<T> = {
    requestId,
    status: "partial",
    data,
    errors,
  };

  return NextResponse.json(body, { status, headers: privateHeaders });
}

export function fail(
  status: number,
  errors: ApiErrorDetail | ApiErrorDetail[],
  requestId = randomUUID(),
) {
  const body: ApiEnvelope<never> = {
    requestId,
    status: "error",
    data: null,
    errors: Array.isArray(errors) ? errors : [errors],
  };

  return NextResponse.json(body, { status, headers: privateHeaders });
}

export function malformedRequest(message = "請檢查輸入資料。") {
  return fail(400, { code: "INVALID_REQUEST", message });
}

export function configurationRequired() {
  return fail(503, {
    code: "SERVICE_NOT_CONFIGURED",
    message: "此功能尚未完成正式環境設定。",
  });
}
