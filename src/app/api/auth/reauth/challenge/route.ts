import { createHash, randomBytes, randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function POST() {
  if (isDemoMode()) {
    return ok({ challengeId: randomUUID(), nonce: "demo", expiresAt: new Date(Date.now() + 300_000).toISOString(), demo: true });
  }

  const [context, supabase] = await Promise.all([
    getTenantContext("staff"),
    createServerSupabaseClient(),
  ]);
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) {
    return fail(503, {
      code: "SERVICE_NOT_CONFIGURED",
      message: "重新驗證服務尚未完成正式環境設定。",
    });
  }
  if (!context) {
    return fail(401, { code: "AUTHENTICATION_REQUIRED", message: "請重新登入。" });
  }

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (
    claimsError ||
    !claims ||
    claims.sub !== context.userId ||
    !UUID.test(claims.session_id) ||
    !Number.isFinite(claims.iat)
  ) {
    return fail(401, {
      code: "INVALID_SESSION",
      message: "登入工作階段無效，請重新登入。",
    });
  }

  const challengeId = randomUUID();
  const nonce = randomBytes(32).toString("base64url");
  const nonceSha256 = createHash("sha256").update(nonce).digest("hex");
  const idempotencyKey = randomUUID();
  const { data, error } = await admin.rpc("issue_aal2_reauth_challenge", {
    p_challenge_id: challengeId,
    p_user_id: context.userId,
    p_session_id: claims.session_id,
    p_nonce_sha256: nonceSha256,
    p_idempotency_key: idempotencyKey,
    p_issued_jwt_iat: new Date(claims.iat * 1000).toISOString(),
    p_issued_jwt_jti: typeof claims.jti === "string" ? claims.jti : null,
    p_ttl_seconds: 300,
  });

  const issued = Array.isArray(data) ? data[0] : data;
  if (error || !issued) {
    return fail(500, {
      code: "REAUTH_CHALLENGE_FAILED",
      message: "無法建立一次性重新驗證挑戰，請稍後再試。",
    });
  }

  return ok({
    challengeId,
    nonce,
    expiresAt:
      typeof issued.expires_at === "string"
        ? issued.expires_at
        : new Date(Date.now() + 300_000).toISOString(),
    demo: false,
  });
}
