type Environment = Readonly<Record<string, string | undefined>>;

export const SYNTHETIC_PREVIEW_PURPOSE = "synthetic-read-only";

const externalKeys = /^(?:(?:NEXT_PUBLIC_)?SUPABASE_|DATABASE_URL$|DIRECT_URL$|POSTGRES_|PG(?:HOST|PORT|USER|PASSWORD|DATABASE|SERVICE|SERVICEFILE)$|DOCUMENT_DOWNLOAD_SIGNING_SECRET$|HTML_ARCHIVE_BUCKET$|AWS_KMS_KEY_ID$|AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|PROFILE|DEFAULT_PROFILE|SHARED_CREDENTIALS_FILE|CONFIG_FILE|WEB_IDENTITY_TOKEN_FILE|ROLE_ARN|ROLE_SESSION_NAME|CONTAINER_CREDENTIALS_RELATIVE_URI|CONTAINER_CREDENTIALS_FULL_URI)$|LINE_CHANNEL_|SMS_(?:API_|SENDER_)|TWILIO_)/u;

function fail(code: string): never {
  // Never include supplied environment values in build or runtime errors.
  throw new Error(code);
}

/** This flag selects synthetic reads only; it never grants API authority. */
export function validateSyntheticPreviewEnvironment(source: Environment): boolean {
  const flag = source.SYNTHETIC_PREVIEW;
  if (flag !== undefined && flag !== "" && flag !== "true" && flag !== "false") {
    fail("SYNTHETIC_PREVIEW_FLAG_INVALID");
  }
  const publicFlag = source.NEXT_PUBLIC_SYNTHETIC_PREVIEW;
  if (publicFlag !== undefined && publicFlag !== "" && publicFlag !== "true" && publicFlag !== "false") {
    fail("SYNTHETIC_PREVIEW_PUBLIC_FLAG_INVALID");
  }
  if (flag !== "true") {
    if (publicFlag === "true" || source.SYNTHETIC_PREVIEW_PURPOSE || source.SYNTHETIC_PREVIEW_PROJECT_ID) {
      fail("SYNTHETIC_PREVIEW_FLAG_MISMATCH");
    }
    return false;
  }
  if (source.SYNTHETIC_PREVIEW_PURPOSE !== SYNTHETIC_PREVIEW_PURPOSE || publicFlag !== "true") {
    fail("SYNTHETIC_PREVIEW_PURPOSE_REQUIRED");
  }
  if (source.DEMO_MODE === "true") fail("SYNTHETIC_PREVIEW_LOCAL_DEMO_CONFLICT");

  const expectedProject = source.SYNTHETIC_PREVIEW_PROJECT_ID;
  const actualProject = source.VERCEL_PROJECT_ID;
  const onVercel = source.VERCEL === "1" || Boolean(source.VERCEL_ENV);
  if (onVercel && source.VERCEL_ENV !== "preview") {
    fail("SYNTHETIC_PREVIEW_DEPLOYMENT_TARGET_INVALID");
  }
  if (onVercel || expectedProject || actualProject) {
    if (!expectedProject || !/^prj_[A-Za-z0-9]+$/u.test(expectedProject) || expectedProject !== actualProject) {
      fail("SYNTHETIC_PREVIEW_PROJECT_BINDING_REQUIRED");
    }
  }
  if (Object.entries(source).some(([key, value]) => Boolean(value?.trim()) &&
      (externalKeys.test(key) || key.startsWith("FINANCE_STORE_") || key.startsWith("CLIENT_DOCUMENTS_")))) {
    fail("SYNTHETIC_PREVIEW_EXTERNAL_CONFIGURATION_FORBIDDEN");
  }
  if (source.SMS_PROVIDER && source.SMS_PROVIDER !== "mock") {
    fail("SYNTHETIC_PREVIEW_EXTERNAL_CONFIGURATION_FORBIDDEN");
  }
  return true;
}

export function isSyntheticPreviewRequestBlocked(method: string, pathname: string): boolean {
  if (method !== "GET" && method !== "HEAD") return true;
  let decoded: string;
  try { decoded = decodeURIComponent(pathname).replace(/\\/gu, "/").toLowerCase(); }
  catch { return true; }
  return decoded === "/api" || decoded.startsWith("/api/");
}
