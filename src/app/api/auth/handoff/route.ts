import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

import {
  portalFormPostFailure, PORTAL_FIRST_ACTIVATION, resolvePortalHandoffConfiguration, portalHandoffRedirect,
  portalTicketHash, readPortalHandoffForm, verifyPortalHandoff,
  type PortalHandoffConfigurationFailure, type PortalFormPostFailure,
} from "@/lib/auth/portal-handoff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const preferredRegion = "hnd1";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
type HandoffStage = "configuration" | "form_parse" | "assertion_verification" | "admin_client"
  | "ticket_claim" | "identity_admission" | "auth_identity_readback" | "session_link_generation"
  | "session_client" | "session_exchange" | "session_verification" | "session_binding" | "staff_admission";
type HandoffFailure = HandoffStage | "ticket_claim_receipt" | `form_${PortalFormPostFailure}`
  | `configuration_${PortalHandoffConfigurationFailure}`;

/** A consumed ticket cannot be retried. Portal must issue a fresh one on failure. */
export async function POST(request: Request) {
  const requestId = randomUUID();
  // Only these server-owned labels reach logs. Never pass provider errors,
  // request headers, signed assertions, identities or Auth credentials here.
  let stage: HandoffStage = "configuration";
  const denied = (failure: HandoffFailure, location?: string) => {
    console.warn("[daycare-portal-handoff]", { requestId, stage: failure });
    const response = portalHandoffRedirect(location);
    response.headers.set("X-Request-ID", requestId);
    return response;
  };
  const resolved = resolvePortalHandoffConfiguration(request);
  const configuration = resolved.configuration;
  if (!configuration) return denied(`configuration_${resolved.failure}`);
  const formFailure = portalFormPostFailure(request);
  if (formFailure) return denied(`form_${formFailure}`);

  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>> = null;
  let sessionAttempted = false;
  let completed = false;
  try {
    stage = "form_parse";
    const form = await readPortalHandoffForm(request);
    if (!form) return denied(stage);
    stage = "assertion_verification";
    const claims = verifyPortalHandoff(form.payload, form.signature, configuration.secret);
    if (!claims) return denied(stage);

    stage = "admin_client";
    const admin = createSupabaseAdminClient();
    if (!admin) return denied(stage);
    const ticketHash = portalTicketHash(claims.jti);
    // The database atomically consumes the JTI and resolves only an already
    // active, individually approved Daycare user with this pinned Google sub.
    stage = "ticket_claim";
    const { data: userId, error: claimError } = await admin.rpc("claim_portal_sso_ticket", {
      p_jti_sha256: ticketHash,
      p_google_sub: claims.googleSub,
      p_email: claims.email,
      p_expires_at: new Date(claims.exp * 1000).toISOString(),
    });
    if (claimError) return denied(stage);
    if (userId === null) {
      // A prior owner-approved first-use invitation still requires one real
      // Daycare Google OAuth activation. This classifier never grants access.
      stage = "identity_admission";
      const pending = await admin.rpc("is_portal_sso_first_activation_pending", {
        p_email: claims.email, p_google_sub: claims.googleSub,
      });
      return denied(stage,
        !pending.error && pending.data === true ? PORTAL_FIRST_ACTIVATION : undefined,
      );
    }
    if (typeof userId !== "string" || !UUID.test(userId)) return denied("ticket_claim_receipt");

    // Never let generateLink provision an unknown address. The consumed claim
    // is tied to this existing Supabase Auth user; a concurrent account change
    // must fail closed before we mint a Daycare session.
    stage = "auth_identity_readback";
    const { data: existing, error: existingError } = await admin.auth.admin.getUserById(userId);
    if (existingError || !existing.user || existing.user.id !== userId
      || existing.user.is_anonymous || !existing.user.email_confirmed_at
      || existing.user.email?.toLowerCase() !== claims.email) return denied(stage);

    stage = "session_link_generation";
    const generated = await admin.auth.admin.generateLink({ type: "magiclink", email: claims.email });
    const hashedToken = generated.data?.properties?.hashed_token;
    if (generated.error || generated.data?.user?.id !== userId
      || typeof hashedToken !== "string" || !/^[A-Za-z0-9_-]{20,512}$/u.test(hashedToken)) {
      return denied(stage);
    }

    stage = "session_client";
    supabase = await createServerSupabaseClient();
    if (!supabase) return denied(stage);
    sessionAttempted = true;
    stage = "session_exchange";
    const exchanged = await supabase.auth.verifyOtp({ token_hash: hashedToken, type: "magiclink" });
    const issuedToken = exchanged.data.session?.access_token;
    if (exchanged.error || typeof issuedToken !== "string" || !issuedToken
      || exchanged.data.user?.id !== userId) {
      throw new Error("PORTAL_SESSION_DENIED");
    }
    // Independently verify the actual newly issued token. A stale same-user
    // cookie must not cause us to bind an older session to this new ticket.
    stage = "session_verification";
    const issuedClaimsResult = await supabase.auth.getClaims(issuedToken);
    const issuedJwt = issuedClaimsResult.data?.claims as Record<string, unknown> | undefined;
    const [userResult, cookieClaimsResult] = await Promise.all([
      supabase.auth.getUser(), supabase.auth.getClaims(),
    ]);
    const verifiedUser = userResult.data.user;
    const cookieJwt = cookieClaimsResult.data?.claims as Record<string, unknown> | undefined;
    const sessionId = issuedJwt?.session_id;
    if (issuedClaimsResult.error || cookieClaimsResult.error || userResult.error
      || !verifiedUser || verifiedUser.id !== userId
      || verifiedUser.is_anonymous || verifiedUser.email?.toLowerCase() !== claims.email
      || !issuedJwt || !cookieJwt
      || issuedJwt.sub !== userId || cookieJwt.sub !== userId
      || issuedJwt.iss !== `${configuration.supabaseOrigin}/auth/v1`
      || cookieJwt.iss !== issuedJwt.iss
      || issuedJwt.role !== "authenticated" || cookieJwt.role !== issuedJwt.role
      || issuedJwt.aal !== "aal1" || cookieJwt.aal !== issuedJwt.aal
      || issuedJwt.is_anonymous === true || cookieJwt.is_anonymous === true
      || typeof sessionId !== "string" || !UUID.test(sessionId)
      || cookieJwt.session_id !== sessionId
      || !Array.isArray(issuedJwt.amr) || !Array.isArray(cookieJwt.amr)
      || !issuedJwt.amr.some((entry: unknown) => typeof entry === "object" && entry !== null
        && ["otp", "magiclink"].includes((entry as { method?: string }).method ?? ""))
      || !cookieJwt.amr.some((entry: unknown) => typeof entry === "object" && entry !== null
        && ["otp", "magiclink"].includes((entry as { method?: string }).method ?? ""))) {
      throw new Error("PORTAL_SESSION_DENIED");
    }

    // This binds the exact Auth session to the consumed ticket, not to a
    // mutable email, a browser cookie, or every future email/OTP session.
    stage = "session_binding";
    const bound = await admin.rpc("bind_portal_sso_session", {
      p_jti_sha256: ticketHash,
      p_session_id: sessionId,
    });
    if (bound.error || bound.data !== true) throw new Error("PORTAL_SESSION_DENIED");
    stage = "staff_admission";
    const allowed = await supabase.rpc("is_staff_login_allowed");
    if (allowed.error || allowed.data !== true) throw new Error("PORTAL_SESSION_DENIED");

    completed = true;
    return portalHandoffRedirect(claims.returnTo);
  } catch {
    // Never expose provider errors, signed claims, OTPs or credentials.
    return denied(stage);
  } finally {
    if (sessionAttempted && !completed) {
      try { await supabase?.auth.signOut({ scope: "local" }); } catch { /* Still clear this project's cookies. */ }
      try {
        const cookieStore = await cookies();
        const escaped = configuration.storageKey.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        const authCookie = new RegExp(`^${escaped}(?:(?:-flow-[A-Za-z0-9_-]{8,64}|-flows)?-code-verifier)?(?:\\.\\d+)?$`, "u");
        for (const { name } of cookieStore.getAll()) {
          if (authCookie.test(name)) cookieStore.set(name, "", {
            path: "/", maxAge: 0, secure: configuration.secure, sameSite: "lax",
          });
        }
      } catch { /* Database admission still denies the unbound session. */ }
    }
  }
}
