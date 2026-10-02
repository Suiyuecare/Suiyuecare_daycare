import "server-only";

import { env } from "@/lib/env";
import { IntegrationError } from "@/lib/integrations/errors";

// Only the configured application origin is trusted. Proxy headers are not a
// source of trust, and this guard does not replace authentication or permissions.
function configuredOrigin(): string | null {
  if (!env.NEXT_PUBLIC_APP_ORIGIN) return null;
  try {
    const url = new URL(env.NEXT_PUBLIC_APP_ORIGIN);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(env.NODE_ENV !== "production" && local && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

// Match the complete MIME value, including syntactically valid parameters.
// Matching only a prefix would admit unrelated or malformed content types.
const jsonContentType = /^application\/json[\t ]*(?:;[\t ]*[!#$%&'*+.^_`|~0-9a-z-]+[\t ]*=[\t ]*(?:[!#$%&'*+.^_`|~0-9a-z-]+|"(?:[\t\x20-\x21\x23-\x5b\x5d-\x7e]|\\[\t\x20-\x7e])*")[\t ]*)*$/iu;

/** Validate a cookie-authenticated JSON POST before reading its body. */
export function requireSameOriginWrite(
  request: Request,
  options: { method: "POST" | "PATCH"; format: "json" | "multipart" },
): void {
  const trustedOrigin = configuredOrigin();
  if (!trustedOrigin) {
    throw new IntegrationError("SERVICE_NOT_CONFIGURED", "系統來源尚未完成設定。", 503);
  }

  let requestOrigin: string | null = null;
  try {
    const url = new URL(request.url);
    if (!url.username && !url.password) requestOrigin = url.origin;
  } catch {
    // Invalid request metadata is denied without reflecting supplied values.
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (request.method !== options.method || requestOrigin !== trustedOrigin ||
      request.headers.get("origin") !== trustedOrigin ||
      (fetchSite !== null && fetchSite !== "same-origin")) {
    throw new IntegrationError("ORIGIN_NOT_ALLOWED", "請從本系統頁面送出操作。", 403);
  }

  const contentType = request.headers.get("content-type");
  const multipartContentType = /^multipart\/form-data;[\t ]*boundary=(?:[!#$%&'*+.^_`|~0-9a-z-]{1,70}|"[0-9a-z'()+_,.\/:=? -]{1,70}")[\t ]*$/iu;
  if (!contentType || !(options.format === "json" ? jsonContentType : multipartContentType).test(contentType)) {
    throw new IntegrationError(options.format === "json" ? "JSON_CONTENT_TYPE_REQUIRED" : "MULTIPART_CONTENT_TYPE_REQUIRED",
      options.format === "json" ? "請使用 JSON 格式送出操作。" : "請從附件上傳入口送出檔案。", 415);
  }
}

/** Existing JSON POST consumers retain their exact method and MIME boundary. */
export function requireSameOriginJsonWrite(request: Request): void {
  requireSameOriginWrite(request, { method: "POST", format: "json" });
}
