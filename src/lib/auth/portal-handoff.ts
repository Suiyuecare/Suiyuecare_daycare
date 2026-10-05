import "server-only";

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env, hasSupabaseAdminConfiguration, isDemoMode, isSyntheticPreviewMode } from "@/lib/env";

export const PORTAL_ORIGIN = "https://login.suiyuecare.com";
export const PORTAL_OAUTH_BRIDGE_ORIGIN = "https://suiyuecare-website.vercel.app";
export const PORTAL_HANDOFF_FAILURE = "/login?error=portal_handoff_failed";
export const PORTAL_FIRST_ACTIVATION = "/login?error=portal_activation_required";
const MAX_TICKET_AGE_SECONDS = 600;
const MAX_FORM_BYTES = 4096;

export type PortalHandoffClaims = {
  email: string;
  googleSub: string;
  aud: "daycare";
  iat: number;
  exp: number;
  jti: string;
  returnTo: string;
};

export type PortalHandoffConfiguration = {
  appOrigin: string;
  supabaseOrigin: string;
  secure: boolean;
  storageKey: string;
  secret: string;
};

function configuredOrigin(value: string | undefined, allowLocal: boolean) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(allowLocal && local && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Configuration is server-owned; Host and X-Forwarded-Host cannot select a destination. */
export function portalHandoffConfiguration(request: Request): PortalHandoffConfiguration | null {
  if (isDemoMode() || isSyntheticPreviewMode() || !hasSupabaseAdminConfiguration()) return null;
  const secret = env.PORTAL_DAYCARE_HANDOFF_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) return null;
  const allowLocal = env.NODE_ENV !== "production";
  const appOrigin = configuredOrigin(env.NEXT_PUBLIC_APP_ORIGIN, allowLocal);
  const supabaseOrigin = configuredOrigin(env.NEXT_PUBLIC_SUPABASE_URL, allowLocal);
  if (!appOrigin || !supabaseOrigin || new URL(request.url).origin !== appOrigin) return null;
  return {
    appOrigin,
    supabaseOrigin,
    secure: appOrigin.startsWith("https:"),
    storageKey: `sb-${new URL(supabaseOrigin).hostname.split(".")[0]}-auth-token`,
    secret,
  };
}

/** Only the two exact company Portal origins, each with its expected Fetch Metadata, may POST. */
export function isPortalFormPost(request: Request) {
  const url = new URL(request.url);
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  const trustedOrigin = (origin === PORTAL_ORIGIN && (!fetchSite || fetchSite === "same-site"))
    || (origin === PORTAL_OAUTH_BRIDGE_ORIGIN && (!fetchSite || fetchSite === "cross-site"));
  return request.method === "POST"
    && url.pathname === "/api/auth/handoff"
    && !url.search && !url.hash
    && trustedOrigin
    && /^application\/x-www-form-urlencoded(?:\s*;|$)/u.test(contentType)
    && Number.isFinite(contentLength) && contentLength <= MAX_FORM_BYTES;
}

export async function readPortalHandoffForm(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteCount += value.byteLength;
    if (byteCount > MAX_FORM_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  const form = new URLSearchParams(body);
  if (form.size !== 2 || form.getAll("payload").length !== 1 || form.getAll("signature").length !== 1) return null;
  return { payload: form.get("payload")!, signature: form.get("signature")! };
}

export function safePortalReturnTo(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 512 || !/^\/app(?:\/|\?|$)/u.test(value)) return false;
  if (/\/\/|\\|#|[\u0000-\u001f\u007f]/u.test(value)) return false;
  const pathname = value.split("?")[0]!;
  if (pathname.includes("%") || pathname.split("/").some((part) => part === "." || part === "..")) return false;
  return true;
}

const CLAIM_KEYS = ["aud", "email", "exp", "googleSub", "iat", "jti", "returnTo"];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Verify exact, canonical signed bytes and a fresh, purpose-bound Google subject. */
export function verifyPortalHandoff(
  payload: string,
  signature: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): PortalHandoffClaims | null {
  if (!/^[A-Za-z0-9_-]{1,2048}$/u.test(payload) || !/^[A-Za-z0-9_-]{43}$/u.test(signature)) return null;
  const expected = createHmac("sha256", secret).update(payload, "ascii").digest();
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== expected.length || provided.toString("base64url") !== signature
    || !timingSafeEqual(provided, expected)) return null;
  try {
    const bytes = Buffer.from(payload, "base64url");
    if (bytes.toString("base64url") !== payload) return null;
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(decoded);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (Buffer.from(JSON.stringify(value), "utf8").toString("base64url") !== payload) return null;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== CLAIM_KEYS.length
      || Object.keys(record).some((key) => !CLAIM_KEYS.includes(key))) return null;
    if (record.aud !== "daycare"
      || typeof record.email !== "string"
      || record.email.length > 254
      || record.email !== record.email.toLowerCase()
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(record.email)
      || typeof record.googleSub !== "string"
      || !/^[A-Za-z0-9_-]{8,255}$/u.test(record.googleSub)
      || typeof record.jti !== "string" || !UUID_V4.test(record.jti)
      || !Number.isSafeInteger(record.iat) || !Number.isSafeInteger(record.exp)
      || (record.iat as number) > nowSeconds + 30
      || (record.exp as number) <= nowSeconds
      || (record.exp as number) <= (record.iat as number)
      || (record.exp as number) - (record.iat as number) > MAX_TICKET_AGE_SECONDS
      || !safePortalReturnTo(record.returnTo)) return null;
    return record as PortalHandoffClaims;
  } catch {
    return null;
  }
}

export function portalTicketHash(jti: string) {
  return createHash("sha256").update(jti, "ascii").digest("hex");
}

export function portalHandoffRedirect(location = PORTAL_HANDOFF_FAILURE) {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: location,
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
