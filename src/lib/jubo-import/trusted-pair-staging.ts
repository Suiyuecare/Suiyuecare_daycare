import "server-only";

import { createHash } from "node:crypto";

import {
  prepareApprovedJuboPair, type JuboPreparedBatch, type JuboPreparedPair,
  type JuboPreparedRow, type JuboPrepareInput,
} from "./trusted-pair-preparation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const ZERO_SHA = "0".repeat(64);
const MAPPING_VERSION = "jubo-master-monthly-202610-v1";

/**
 * Only a server-owned, privileged direct PostgreSQL connection may implement
 * this contract. It MUST bind a cryptographically verified current user JWT to
 * the transaction's request.jwt.claims; never use browser-provided claims or
 * a service_role Data API client. The private tables/functions are deliberately
 * not granted to authenticated, anon or service_role.
 */
export interface VerifiedJuboSqlTransaction {
  query<T extends Record<string, unknown>>(
    sql: string, values: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface VerifiedJuboSqlDatabase {
  withVerifiedUserTransaction<T>(
    actorUserId: string,
    action: (transaction: VerifiedJuboSqlTransaction) => Promise<T>,
  ): Promise<T>;
}

/** Structural pg.Pool shape, avoiding any browser/runtime database binding. */
export interface JuboPrivatePgPool {
  connect(): Promise<VerifiedJuboSqlTransaction & { release(error?: Error): void }>;
}

export interface JuboCurrentSessionProvider {
  /** Read only from verified server cookies/session, never a request body. */
  accessToken(): Promise<string | null>;
  /** Supabase Auth getUser(token) or an equivalent online verifier. */
  getUser(token: string): Promise<{
    data: { user: { id: string } | null } | null;
    error: unknown | null;
  }>;
}

function verifiedJwtClaims(token: string, expectedActor: string): Record<string, string | number> {
  if (typeof token !== "string" || token.length > 8192) throw new JuboStageError("UNVERIFIED_ACTOR");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[1].length > 6144) throw new JuboStageError("UNVERIFIED_ACTOR");
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); }
  catch { throw new JuboStageError("UNVERIFIED_ACTOR"); }
  if (!payload || typeof payload !== "object") throw new JuboStageError("UNVERIFIED_ACTOR");
  const claims = payload as Record<string, unknown>;
  if (claims.sub !== expectedActor || !UUID.test(String(claims.session_id ?? "")) ||
      claims.aal !== "aal2" || claims.role !== "authenticated" ||
      typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new JuboStageError("UNVERIFIED_ACTOR");
  }
  // Only claims required by existing DB authority functions are forwarded.
  // Auth has first verified the complete token online before this decoder runs.
  return { sub: expectedActor, session_id: String(claims.session_id),
    aal: "aal2", role: "authenticated", exp: claims.exp };
}

/**
 * Concrete transaction binder for a server-owned private PostgreSQL pool.
 * The caller must keep the pool credentials out of Vercel client bundles and
 * provide an online Auth verifier; no environment connection is created here.
 */
export function createVerifiedJuboSqlDatabase(
  pool: JuboPrivatePgPool, session: JuboCurrentSessionProvider,
): VerifiedJuboSqlDatabase {
  return {
    async withVerifiedUserTransaction(actorUserId, action) {
      const token = await session.accessToken();
      if (!token) throw new JuboStageError("UNVERIFIED_ACTOR");
      let verified: Awaited<ReturnType<JuboCurrentSessionProvider["getUser"]>>;
      try { verified = await session.getUser(token); }
      catch { throw new JuboStageError("UNVERIFIED_ACTOR"); }
      if (verified.error !== null || verified.data?.user?.id !== actorUserId) {
        throw new JuboStageError("UNVERIFIED_ACTOR");
      }
      const claims = verifiedJwtClaims(token, actorUserId);
      const client = await pool.connect();
      let began = false;
      let commitAttempted = false;
      let discardConnection = false;
      try {
        await client.query("begin", []);
        began = true;
        await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
        const result = await action(client);
        commitAttempted = true;
        await client.query("commit", []);
        began = false;
        return result;
      } catch (error) {
        if (commitAttempted) discardConnection = true;
        if (began) {
          try { await client.query("rollback", []); }
          catch { discardConnection = true; }
        }
        throw error;
      } finally {
        // A failed/unknown COMMIT or failed rollback must not return a possibly
        // open transaction or JWT claims context to the pool.
        client.release(discardConnection ? new Error("JUBO_STAGING_CONNECTION_UNCERTAIN") : undefined);
      }
    },
  };
}

export type JuboStageInput = Omit<JuboPrepareInput, "hmacSecret"> & {
  /** Explicit human classification of the A-only trailing source row. */
  readonly footerReviewReason: string;
};

export type JuboStageReceipt = Readonly<{
  operationId: string;
  verifiedPairId: string;
  masterBatchId: string;
  monthlyBatchId: string;
  masterSha256: string;
  monthlySha256: string;
  masterRows: 23;
  monthlyRows: 17;
  sourceStatus: Readonly<{ active: 17; suspended: 1; closed: 5 }>;
  masterNonRecordRows: 1;
  parserVersion: JuboPreparedPair["parserVersion"];
  stagingOnly: true;
  formallyImported: false;
  replayed: boolean;
}>;

export class JuboStageError extends Error {
  constructor(public readonly code:
    "FOOTER_REVIEW_REQUIRED" | "UNVERIFIED_ACTOR" | "IDEMPOTENCY_CONFLICT" |
    "ALREADY_STAGED" | "INVALID_DATABASE_RESULT" | "STAGING_RESULT_UNKNOWN") {
    // Never surface SQL error text, file name, identifiers or row values.
    super(`Jubo trusted staging failed: ${code}`);
    this.name = "JuboStageError";
  }
}

type StageDependencies = {
  readonly database: VerifiedJuboSqlDatabase;
  /** Server-managed key only; never an HTTP field or NEXT_PUBLIC variable. */
  readonly hmacSecret: string | Uint8Array;
};

function oneUuid(rows: readonly Record<string, unknown>[], column: string): string {
  if (rows.length !== 1 || typeof rows[0]?.[column] !== "string" || !UUID.test(rows[0][column])) {
    throw new JuboStageError("INVALID_DATABASE_RESULT");
  }
  return rows[0][column].toLowerCase();
}

function jsonArray(values: readonly unknown[], width: number): string {
  if (values.length !== width || values.some((value) => value === undefined)) {
    throw new JuboStageError("INVALID_DATABASE_RESULT");
  }
  const text = JSON.stringify(values);
  if (!text || Buffer.byteLength(text, "utf8") > 262_144) {
    throw new JuboStageError("INVALID_DATABASE_RESULT");
  }
  return text;
}

function storagePath(pair: JuboPreparedPair, batch: JuboPreparedBatch): string {
  // This is a logical private-DB locator, NOT an assertion that an object was
  // uploaded to Supabase Storage or WORM archive.
  return `organizations/${pair.organizationId}/branches/${pair.branchId}/jubo/private-db/${batch.sha256}.xlsx`;
}

async function insertBatch(tx: VerifiedJuboSqlTransaction, pair: JuboPreparedPair, batch: JuboPreparedBatch): Promise<string> {
  const kind = batch.kind === "master" ? "client_master" : "daycare_monthly_summary";
  const width = kind === "client_master" ? 95 : 191;
  if (batch.columnLabels.length !== width || !SHA256.test(batch.sha256) ||
      batch.sourceBytesHex.length !== batch.byteLength * 2) {
    throw new JuboStageError("INVALID_DATABASE_RESULT");
  }
  const result = await tx.query<{ id: string }>(`insert into private.jubo_source_batches
    (organization_id,branch_id,source_kind,source_sha256,source_filename,
      storage_path,column_labels,section_labels,declared_row_count,mapping_version,
      source_storage_backend,source_bytes)
    values ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,
      'private_db',decode($11,'hex')) returning id::text`, [
    pair.organizationId, pair.branchId, kind, batch.sha256, batch.fileName,
    storagePath(pair, batch), jsonArray(batch.columnLabels, width),
    JSON.stringify(Array(width).fill(null)), batch.rows.length,
    MAPPING_VERSION, batch.sourceBytesHex,
  ]);
  return oneUuid(result.rows, "id");
}

async function insertRow(tx: VerifiedJuboSqlTransaction, pair: JuboPreparedPair,
  batchId: string, row: JuboPreparedRow, width: number): Promise<void> {
  if (!Number.isSafeInteger(row.sheetRow) || row.sheetRow < 1) {
    throw new JuboStageError("INVALID_DATABASE_RESULT");
  }
  const result = await tx.query<{ id: string }>(`insert into private.jubo_source_rows
    (batch_id,organization_id,branch_id,source_row_number,identity_sha256,
      raw_values,normalized_values,raw_cell_types,row_sha256)
    values ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)
    returning id::text`, [
    batchId, pair.organizationId, pair.branchId, row.sheetRow, ZERO_SHA,
    jsonArray(row.rawValues, width), jsonArray(row.normalizedValues, width),
    jsonArray(row.rawCellTypes, width), ZERO_SHA,
  ]);
  oneUuid(result.rows, "id");
}

async function insertFooter(tx: VerifiedJuboSqlTransaction, pair: JuboPreparedPair,
  batchId: string, reason: string): Promise<void> {
  const row = pair.masterNonRecordRows[0];
  if (!row || row.sheetRow !== 29 || row.rawValues.length !== 95 ||
      row.normalizedValues.length !== 95 || row.rawCellTypes.length !== 95) {
    throw new JuboStageError("INVALID_DATABASE_RESULT");
  }
  const result = await tx.query<{ id: string }>(`insert into private.jubo_source_nonrecord_rows
    (batch_id,organization_id,branch_id,source_row_number,raw_values,
      normalized_values,raw_cell_types,row_sha256,review_reason,reviewed_by)
    values ($1::uuid,$2::uuid,$3::uuid,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10::uuid)
    returning id::text`, [
    batchId, pair.organizationId, pair.branchId, row.sheetRow,
    jsonArray(row.rawValues, 95), jsonArray(row.normalizedValues, 95),
    jsonArray(row.rawCellTypes, 95), ZERO_SHA, reason, pair.actorUserId,
  ]);
  oneUuid(result.rows, "id");
}

function receipt(pair: JuboPreparedPair, operationId: string, verifiedPairId: string,
  masterBatchId: string, monthlyBatchId: string, replayed: boolean): JuboStageReceipt {
  return Object.freeze({
    operationId, verifiedPairId, masterBatchId, monthlyBatchId,
    masterSha256: pair.master.sha256, monthlySha256: pair.monthlySummary.sha256,
    masterRows: 23, monthlyRows: 17,
    sourceStatus: Object.freeze({ active: 17, suspended: 1, closed: 5 }),
    masterNonRecordRows: 1, parserVersion: pair.parserVersion,
    stagingOnly: true, formallyImported: false, replayed,
  });
}

/**
 * Stages ONLY the pinned October 2026 source pair. A caller must supply exact
 * original XLSX bytes and an explicit footer review. A verified DB transaction
 * atomically stores those same bytes, raw/normalized cell arrays, source row
 * coordinates and the immutable attestation. It never creates public.clients.
 */
export async function stageApprovedJuboPair(dependencies: StageDependencies, input: JuboStageInput): Promise<JuboStageReceipt> {
  const reason = typeof input.footerReviewReason === "string" ? input.footerReviewReason.trim() : "";
  if (reason.length < 10 || reason.length > 500) throw new JuboStageError("FOOTER_REVIEW_REQUIRED");
  // This function owns bytes before the first await and reuses the existing
  // hash-allowlisted reader + 23/17 planner; no independent XLSX parser.
  const pair = prepareApprovedJuboPair({ ...input, hmacSecret: dependencies.hmacSecret });
  const requestSha256 = createHash("sha256").update(JSON.stringify([
    "jubo-private-stage-v1", pair.requestSha256, reason,
  ]), "utf8").digest("hex");
  try {
    return await dependencies.database.withVerifiedUserTransaction(pair.actorUserId, async (tx) => {
      const authority = await tx.query<{ actor_user_id: string; can_approve: boolean; challenge_id: string }>(`
        select auth.uid()::text as actor_user_id,
          private.has_permission($1::uuid,$2::uuid,'imports.approve') as can_approve,
          private.require_import_upload_authority($1::uuid,$2::uuid) as challenge_id`,
      [pair.organizationId, pair.branchId]);
      if (authority.rows.length !== 1 ||
          authority.rows[0]?.actor_user_id !== pair.actorUserId ||
          authority.rows[0]?.can_approve !== true ||
          !UUID.test(authority.rows[0]?.challenge_id ?? "")) throw new JuboStageError("UNVERIFIED_ACTOR");
      const challengeId = authority.rows[0]!.challenge_id;

      await tx.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`jubo-private-stage:${pair.actorUserId}:${pair.idempotencyKey}`]);
      const previous = await tx.query<{
        id: string; organization_id: string; branch_id: string; request_sha256: string;
        master_batch_id: string; monthly_batch_id: string; verified_pair_id: string;
      }>(`select id::text,organization_id::text,branch_id::text,request_sha256,
          master_batch_id::text,monthly_batch_id::text,verified_pair_id::text
        from private.jubo_source_stage_operations
        where actor_user_id=$1::uuid and idempotency_key=$2::uuid for update`,
      [pair.actorUserId, pair.idempotencyKey]);
      if (previous.rows.length > 1) throw new JuboStageError("INVALID_DATABASE_RESULT");
      if (previous.rows.length === 1) {
        const row = previous.rows[0]!;
        if (row.organization_id !== pair.organizationId || row.branch_id !== pair.branchId ||
            row.request_sha256 !== requestSha256) throw new JuboStageError("IDEMPOTENCY_CONFLICT");
        for (const value of [row.id,row.master_batch_id,row.monthly_batch_id,row.verified_pair_id]) {
          if (!UUID.test(value)) throw new JuboStageError("INVALID_DATABASE_RESULT");
        }
        return receipt(pair,row.id,row.verified_pair_id,row.master_batch_id,row.monthly_batch_id,true);
      }

      const masterBatchId = await insertBatch(tx,pair,pair.master);
      const monthlyBatchId = await insertBatch(tx,pair,pair.monthlySummary);
      for (const row of pair.master.rows) await insertRow(tx,pair,masterBatchId,row,95);
      for (const row of pair.monthlySummary.rows) await insertRow(tx,pair,monthlyBatchId,row,191);
      await insertFooter(tx,pair,masterBatchId,reason);
      const attested = await tx.query<{ id: string }>(`select private.register_verified_jubo_pair(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,decode($5,'hex'),decode($6,'hex'),
        $7::jsonb,$8::jsonb,$9) as id`, [
        pair.organizationId,pair.branchId,masterBatchId,monthlyBatchId,
        pair.master.sourceBytesHex,pair.monthlySummary.sourceBytesHex,
        jsonArray(pair.master.columnLabels,95),jsonArray(pair.monthlySummary.columnLabels,191),
        pair.parserVersion,
      ]);
      const verifiedPairId = oneUuid(attested.rows,"id");
      const operation = await tx.query<{ id: string }>(`insert into private.jubo_source_stage_operations
        (organization_id,branch_id,actor_user_id,reauth_challenge_id,idempotency_key,request_sha256,
          master_batch_id,monthly_batch_id,verified_pair_id,parser_version)
        values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7::uuid,$8::uuid,$9::uuid,$10)
        returning id::text`, [
        pair.organizationId,pair.branchId,pair.actorUserId,challengeId,pair.idempotencyKey,requestSha256,
        masterBatchId,monthlyBatchId,verifiedPairId,pair.parserVersion,
      ]);
      return receipt(pair,oneUuid(operation.rows,"id"),verifiedPairId,masterBatchId,monthlyBatchId,false);
    });
  } catch (error) {
    if (error instanceof JuboStageError) throw error;
    // An exception after an unknown COMMIT outcome must be retried with the
    // same idempotency key; never report that the DB definitely rolled back.
    const sqlstate = error && typeof error === "object" && "code" in error ? error.code : null;
    if (sqlstate === "23505") throw new JuboStageError("ALREADY_STAGED");
    throw new JuboStageError("STAGING_RESULT_UNKNOWN");
  }
}
