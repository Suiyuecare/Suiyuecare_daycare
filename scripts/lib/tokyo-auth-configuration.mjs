import { configuredAuthOrigin } from "../../src/lib/auth/origin-policy.mjs";

// These are the reviewed cutover destinations, not configurable overrides.
const APP_ORIGIN = "https://daycare.suiyuecare.com";
const AUTH_ORIGIN = "https://diompsnswchpfguvryan.supabase.co";
export const TOKYO_AUTH_CONFIGURATION_FIELDS = Object.freeze([
  "NODE_ENV", "NEXT_PUBLIC_APP_ORIGIN", "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY",
  "GOOGLE_LOGIN_ENABLED", "PORTAL_DAYCARE_HANDOFF_SECRET",
]);
const publicSecrets = ["NEXT_PUBLIC_SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_PORTAL_DAYCARE_HANDOFF_SECRET", "NEXT_PUBLIC_PORTAL_HANDOFF_SECRET"];
const modeFlags = ["DEMO_MODE", "SYNTHETIC_PREVIEW", "NEXT_PUBLIC_SYNTHETIC_PREVIEW"];

/**
 * Injected configuration only. Opaque API keys cannot prove project binding;
 * a syntactically correct callback destination cannot prove Google's allowlist.
 * No env-file loading, network, Auth session or deployment mutation occurs.
 * @param {Readonly<Record<string, string | undefined>>} source
 */
export function inspectTokyoAuthConfiguration(source) {
  const missing = [];
  const invalid = [];
  for (const field of TOKYO_AUTH_CONFIGURATION_FIELDS) {
    const value = source[field];
    if (value === undefined || typeof value === "string" && value.trim() === "") {
      missing.push(field);
      continue;
    }
    let valid = false;
    if (typeof value === "string") {
      switch (field) {
        case "NODE_ENV": valid = value === "production"; break;
        case "NEXT_PUBLIC_APP_ORIGIN":
          valid = configuredAuthOrigin(value, false) === APP_ORIGIN && value === APP_ORIGIN; break;
        case "NEXT_PUBLIC_SUPABASE_URL":
          valid = configuredAuthOrigin(value, false) === AUTH_ORIGIN && value === AUTH_ORIGIN; break;
        case "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": valid = /^sb_publishable_[A-Za-z0-9_-]+$/u.test(value); break;
        case "SUPABASE_SECRET_KEY": valid = /^sb_secret_[A-Za-z0-9_-]+$/u.test(value); break;
        case "GOOGLE_LOGIN_ENABLED": valid = value === "true"; break;
        case "PORTAL_DAYCARE_HANDOFF_SECRET":
          valid = Buffer.byteLength(value, "utf8") >= 32 && value === value.trim()
            && !/[\u0000-\u001f\u007f]/u.test(value)
            && value !== source.SUPABASE_SECRET_KEY && value !== source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; break;
      }
    }
    if (!valid) invalid.push(field);
  }
  for (const field of modeFlags) {
    if (source[field] !== undefined && source[field] !== "" && source[field] !== "false") invalid.push(field);
  }
  for (const field of publicSecrets) {
    if (source[field]?.trim()) invalid.push(field);
  }
  // Residual preview-purpose fields must not survive into a real auth build.
  for (const field of ["SYNTHETIC_PREVIEW_PURPOSE", "SYNTHETIC_PREVIEW_PROJECT_ID"]) {
    if (source[field]?.trim()) invalid.push(field);
  }
  return {
    status: invalid.length ? "invalid" : missing.length ? "missing" : "configured_unverified",
    missing, invalid, proofLevel: "configuration-syntax-and-origins-only",
    connectionVerified: false, keyProjectBindingVerified: false,
    googleLoginVerified: false, portalSsoVerified: false, productionReady: false,
    pendingExternalChecks: ["GOOGLE_PROVIDER_AND_CALLBACK_ALLOWLIST", "SUPABASE_KEYS_SAME_PROJECT",
      "AUTH_SITE_URL_AND_REDIRECT_ALLOWLIST", "PORTAL_PROTOCOL_AND_DEDICATED_SECRET_AGREEMENT",
      "REAL_CEO_AND_DIRECTOR_LOGIN", "CROSS_ROLE_BRANCH_AND_REVOKED_SESSION_DENIAL"],
    externalRequests: 0, writes: 0,
  };
}
