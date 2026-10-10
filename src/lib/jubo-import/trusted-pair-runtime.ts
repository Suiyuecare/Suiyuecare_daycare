import "server-only";

import { Pool } from "pg";

import { isDemoMode, isSyntheticPreviewMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  createVerifiedJuboSqlDatabase,
  stageApprovedJuboPair,
  type JuboPrivatePgPool,
  type JuboStageInput,
  type JuboStageReceipt,
} from "./trusted-pair-staging";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PROJECT_REF = /^[a-z0-9]{20}$/u;
const TOKYO_POOLER = /^aws-\d+-ap-northeast-1\.pooler\.supabase\.com$/u;

export class JuboStageRuntimeError extends Error {
  constructor(public readonly code: "DISABLED" | "MISCONFIGURED" | "AUTH_DENIED") {
    // Do not echo environment values, access tokens or PostgreSQL errors.
    super(`Jubo staging runtime unavailable: ${code}`);
    this.name = "JuboStageRuntimeError";
  }
}

export type JuboStageRuntimeConfiguration = Readonly<{
  organizationId: string;
  branchId: string;
  databaseUrl: string;
  hmacSecret: string;
}>;

/**
 * Production-only opt-in. Bind the Auth project, the PostgreSQL user/project,
 * and the Tokyo transaction-pooler host before a connection can be created.
 * The flag is deliberately absent from any NEXT_PUBLIC_ setting.
 */
export function resolveJuboStageRuntimeConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): JuboStageRuntimeConfiguration {
  if (environment.JUBO_PRIVATE_STAGE_ENABLED !== "true" ||
      environment.NODE_ENV !== "production" || environment.VERCEL_ENV !== "production" ||
      environment.VERCEL_REGION !== "hnd1") {
    throw new JuboStageRuntimeError("DISABLED");
  }
  const publicUrl = environment.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const projectRef = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/u.exec(publicUrl)?.[1] ?? "";
  const organizationId = environment.JUBO_PRIVATE_STAGE_ORGANIZATION_ID ?? "";
  const branchId = environment.JUBO_PRIVATE_STAGE_BRANCH_ID ?? "";
  const hmacSecret = environment.JUBO_PRIVATE_STAGE_HMAC_SECRET ?? "";
  const databaseUrl = environment.JUBO_PRIVATE_STAGE_DATABASE_URL ?? "";
  if (!PROJECT_REF.test(projectRef) || !UUID.test(organizationId) || !UUID.test(branchId) ||
      Buffer.byteLength(hmacSecret, "utf8") < 32 || databaseUrl.length > 2048) {
    throw new JuboStageRuntimeError("MISCONFIGURED");
  }
  let url: URL;
  try { url = new URL(databaseUrl); }
  catch { throw new JuboStageRuntimeError("MISCONFIGURED"); }
  if (!(["postgres:", "postgresql:"].includes(url.protocol)) ||
      !TOKYO_POOLER.test(url.hostname) || url.port !== "6543" ||
      url.username !== `postgres.${projectRef}` || !url.password ||
      url.pathname !== "/postgres" || url.search || url.hash) {
    throw new JuboStageRuntimeError("MISCONFIGURED");
  }
  return { organizationId: organizationId.toLowerCase(), branchId: branchId.toLowerCase(),
    hmacSecret, databaseUrl };
}

let privatePool: Pool | null = null;
let privatePoolUrl: string | null = null;

function getPrivatePool(config: JuboStageRuntimeConfiguration): JuboPrivatePgPool {
  if (!privatePool || privatePoolUrl !== config.databaseUrl) {
    // A changed credential requires a new process; do not silently leave an
    // old pool alive while another production database receives writes.
    if (privatePool) throw new JuboStageRuntimeError("MISCONFIGURED");
    privatePool = new Pool({ connectionString: config.databaseUrl,
      max: 1, connectionTimeoutMillis: 8_000, idleTimeoutMillis: 10_000,
      allowExitOnIdle: true, ssl: { rejectUnauthorized: true } });
    privatePool.on("error", () => {
      // Idle-pool errors must not crash the process or disclose credentials.
      // The pool discards the failed client and the next operation reconnects.
      console.error("JUBO_PRIVATE_POOL_IDLE_ERROR");
    });
    privatePoolUrl = config.databaseUrl;
  }
  return {
    async connect() {
      const client = await privatePool!.connect();
      return {
        async query<T extends Record<string, unknown>>(sql: string, values: readonly unknown[]) {
          // node-postgres uses unnamed parameterized statements by default;
          // the Supabase transaction pooler cannot accept named prepares.
          const result = await client.query<T>(sql, [...values]);
          return { rows: result.rows };
        },
        release(error?: Error) { client.release(error); },
      };
    },
  };
}

export type CurrentStaffJuboStageInput = Omit<JuboStageInput,
  "organizationId" | "branchId" | "actorUserId">;

/**
 * This is intentionally NOT an API route or a scheduled worker. A future
 * Node.js-only, staff-authorized entry point must call it after its own
 * content-length and multipart limits. Nothing invokes it by default.
 */
export async function stageApprovedJuboPairForCurrentStaff(
  input: CurrentStaffJuboStageInput,
): Promise<JuboStageReceipt> {
  const config = resolveJuboStageRuntimeConfiguration();
  if (isDemoMode() || isSyntheticPreviewMode()) throw new JuboStageRuntimeError("DISABLED");

  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try { supabase = await createServerSupabaseClient(); }
  catch { throw new JuboStageRuntimeError("AUTH_DENIED"); }
  if (!supabase) throw new JuboStageRuntimeError("AUTH_DENIED");
  // getSession supplies only the raw token. Its cookie-derived user is never
  // authorization evidence; getUser(token) verifies it with the Auth server.
  let token: string;
  let actorUserId: string;
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const currentToken = sessionData.session?.access_token;
    if (sessionError || !currentToken) throw new JuboStageRuntimeError("AUTH_DENIED");
    const { data: userData, error: userError } = await supabase.auth.getUser(currentToken);
    if (userError || !userData.user) throw new JuboStageRuntimeError("AUTH_DENIED");
    const { data: admitted, error: admissionError } = await supabase.rpc("is_staff_login_allowed");
    if (admissionError || admitted !== true) throw new JuboStageRuntimeError("AUTH_DENIED");
    token = currentToken;
    actorUserId = userData.user.id;
  } catch {
    throw new JuboStageRuntimeError("AUTH_DENIED");
  }

  const database = createVerifiedJuboSqlDatabase(getPrivatePool(config), {
    accessToken: async () => token,
    getUser: (currentToken) => supabase.auth.getUser(currentToken),
  });
  return stageApprovedJuboPair({ database, hmacSecret: config.hmacSecret }, {
    ...input, organizationId: config.organizationId, branchId: config.branchId,
    actorUserId,
  });
}
