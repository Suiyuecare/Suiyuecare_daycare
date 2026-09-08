import "server-only";

import { z } from "zod";
import { validateSyntheticPreviewEnvironment } from "@/lib/synthetic-preview/config";

const syntheticPreview = validateSyntheticPreviewEnvironment(process.env);

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional().or(z.literal("")),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  GOOGLE_LOGIN_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  AWS_REGION: z.string().default("ap-northeast-1"),
  HTML_ARCHIVE_BUCKET: z.string().optional(),
  AWS_KMS_KEY_ID: z.string().optional(),
  LINE_CHANNEL_SECRET: z.string().optional(),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().optional(),
  SMS_PROVIDER: z.string().default("mock"),
  NEXT_PUBLIC_APP_ORIGIN: z.string().url().default("http://localhost:3000"),
});

export const env = serverEnvSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  DEMO_MODE: process.env.DEMO_MODE,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  GOOGLE_LOGIN_ENABLED: process.env.GOOGLE_LOGIN_ENABLED,
  AWS_REGION: process.env.AWS_REGION,
  HTML_ARCHIVE_BUCKET: process.env.HTML_ARCHIVE_BUCKET,
  AWS_KMS_KEY_ID: process.env.AWS_KMS_KEY_ID,
  LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET,
  LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  SMS_PROVIDER: process.env.SMS_PROVIDER,
  NEXT_PUBLIC_APP_ORIGIN: process.env.NEXT_PUBLIC_APP_ORIGIN,
});

export function isDemoMode() {
  return env.NODE_ENV !== "production" && env.DEMO_MODE === "true";
}

export function isSyntheticPreviewMode() {
  return syntheticPreview;
}

/** Presentation-only: never use this helper to authorize an API operation. */
export function isSyntheticReadMode() {
  return isDemoMode() || isSyntheticPreviewMode();
}

export function hasSupabaseConfiguration() {
  if (isSyntheticPreviewMode()) return false;
  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL &&
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function hasSupabaseAdminConfiguration() {
  return hasSupabaseConfiguration() && Boolean(env.SUPABASE_SECRET_KEY);
}
