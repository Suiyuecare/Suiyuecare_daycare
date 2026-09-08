import type { NextConfig } from "next";
import { validateSyntheticPreviewEnvironment } from "./src/lib/synthetic-preview/policy";

const syntheticPreview = validateSyntheticPreviewEnvironment(process.env);

const scriptPolicy =
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

function supabaseConnectPolicy() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configuredUrl) return "connect-src 'self'";
  try {
    const url = new URL(configuredUrl);
    const websocketProtocol = url.protocol === "https:" ? "wss:" : "ws:";
    return `connect-src 'self' ${url.origin} ${websocketProtocol}//${url.host}`;
  } catch {
    return "connect-src 'self'";
  }
}

const strictTransportSecurity =
  process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : [];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    typedEnv: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...(syntheticPreview ? [
            { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
            { key: "Cache-Control", value: "private, no-store, max-age=0" },
            { key: "X-Daycare-Mode", value: "synthetic-read-only" },
          ] : []),
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; ${scriptPolicy}; ${supabaseConnectPolicy()}; upgrade-insecure-requests`,
          },
          ...strictTransportSecurity,
        ],
      },
      {
        source: "/app/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
      {
        source: "/family/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
      {
        source: "/login",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
      {
        source: "/mfa",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
