import { createHash } from "node:crypto";

import { IntegrationError } from "./errors";
export { parseIsoDateTime } from "./datetime";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function assertUuid(value: string, field: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new IntegrationError(
      "INVALID_UUID",
      "識別碼格式錯誤。",
      400,
      field,
    );
  }
  return value.toLowerCase();
}

export function assertIdempotencyKey(value: unknown, field = "idempotency_key") {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new IntegrationError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "請提供 8 至 200 字元的有效冪等鍵。",
      400,
      field,
    );
  }
  return value;
}

function canonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new IntegrationError(
        "INVALID_JSON_NUMBER",
        "資料包含無效數字。",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(object[key])}`)
      .join(",")}}`;
  }
  throw new IntegrationError("INVALID_JSON_VALUE", "資料包含無效內容。");
}

export function canonicalJson(value: unknown) {
  return canonicalValue(value);
}

export function sha256Hex(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Convert an arbitrary client idempotency token into a deterministic UUID.
 * The original token is never persisted or returned.
 */
export function deterministicUuid(...parts: string[]) {
  const bytes = createHash("sha256")
    .update(parts.map((part) => `${part.length}:${part}`).join("|"))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function payloadHash(value: unknown) {
  return sha256Hex(canonicalJson(value));
}

