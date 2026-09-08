import { createHash } from "node:crypto";

import { ok, fail } from "@/lib/api/response";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReauthBody = { challengeId?: unknown; nonce?: unknown };

export async function POST(request: Request) {
  if (isDemoMode()) {
    return ok({ recorded: true, demo: true });
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return fail(503, {
      code: "SERVICE_NOT_CONFIGURED",
      message: "驗證服務尚未設定。",
    });
  }

  let body: ReauthBody;
  try {
    body = (await request.json()) as ReauthBody;
  } catch {
    return fail(400, { code: "INVALID_REQUEST", message: "重新驗證資料格式錯誤。" });
  }
  if (
    typeof body.challengeId !== "string" ||
    !/^[0-9a-f-]{36}$/iu.test(body.challengeId) ||
    typeof body.nonce !== "string" ||
    body.nonce.length < 32 ||
    body.nonce.length > 128
  ) {
    return fail(400, { code: "INVALID_REQUEST", message: "重新驗證資料不完整。" });
  }

  const nonceSha256 = createHash("sha256").update(body.nonce).digest("hex");

  const { data, error } = await supabase.rpc("record_aal2_reauth", {
    p_challenge_id: body.challengeId,
    p_nonce_sha256: nonceSha256,
  });
  if (error || data !== true) {
    return fail(403, {
      code: "FRESH_AAL2_REQUIRED",
      message: "未偵測到本次挑戰後完成的第二因素驗證，請重新操作。",
    });
  }

  return ok({ recorded: true, demo: false });
}
