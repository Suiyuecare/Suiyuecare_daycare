import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { bootstrapSql } from "../../../scripts/lib/pglite-bootstrap.mjs";
import {
  projectIntegrationsAuditSnapshot,
  type IntegrationsAuditSnapshotSourceRow,
} from "./projection";
import type { IntegrationsAuditFilters } from "./types";

const ORGANIZATION_ID = "83d10000-0000-4000-8000-000000000001";
const BRANCH_ID = "83d20000-0000-4000-8000-000000000001";
const ACTOR_ID = "83d30000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "83d40000-0000-4000-8000-000000000001";
const SESSION_ID = "83d50000-0000-4000-8000-000000000001";
const CHALLENGE_ID = "83d60000-0000-4000-8000-000000000001";
const IMPORT_ID = "83d70000-0000-4000-8000-000000000001";
const IMPORT_CORRELATION_ID = "83d80000-0000-4000-8000-000000000001";
const AUDIT_REQUEST_ID = "83d90000-0000-4000-8000-000000000001";
const WINDOW_DATE = "2026-09-08";

const baseFilters: IntegrationsAuditFilters = {
  startDate: WINDOW_DATE,
  endDate: WINDOW_DATE,
  integrationKey: "central_html_import",
  activityState: "all",
  auditAction: "integration",
  resourceCategory: "import",
  actorUserId: ACTOR_ID,
  correlationId: null,
};

// This contract exercises the actual PostgreSQL JSON row and then the strict
// TypeScript projector. It does not mock or reconstruct the RPC payload.
describe("Page 83 PostgreSQL to TypeScript snapshot contract", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(bootstrapSql);
    const directory = resolve("supabase/migrations");
    const files = (await readdir(directory)).filter((file) =>
      file.endsWith(".sql") && file <= "20260908009000_integrations_audit_page83.sql"
    ).sort();
    expect(files.at(-1)).toBe("20260908009000_integrations_audit_page83.sql");
    for (const file of files) {
      await database.exec(await readFile(resolve(directory, file), "utf8"));
    }

    await database.query(
      `insert into auth.users(id,aud,role,email,created_at,updated_at)
       values($1,'authenticated','authenticated','page83-contract@example.invalid',now(),now())`,
      [ACTOR_ID],
    );
    await database.query(
      "insert into public.organizations(id,code,name) values($1,'page83_contract','Page83 合成契約機構')",
      [ORGANIZATION_ID],
    );
    await database.query(
      `insert into public.branches(id,organization_id,code,name)
       values($1,$2,'main','Page83 合成契約分支')`,
      [BRANCH_ID, ORGANIZATION_ID],
    );
    await database.query(
      "insert into public.profiles(id,display_name,kind) values($1,'Page83 合成稽核員','staff')",
      [ACTOR_ID],
    );
    await database.query(
      `insert into public.memberships(id,organization_id,branch_id,profile_id,status)
       values($1,$2,$3,$4,'active')`,
      [MEMBERSHIP_ID, ORGANIZATION_ID, BRANCH_ID, ACTOR_ID],
    );
    await database.query(
      `insert into public.membership_roles(membership_id,role_id)
       select $1,id from public.roles
       where role_key='organization_manager' and is_system`,
      [MEMBERSHIP_ID],
    );
    await database.query(
      `insert into private.reauth_challenges(
         id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
         created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at
       ) values(
         $1,$2,$3,repeat('a',64),$1,clock_timestamp()-interval '2 minutes',
         clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 minutes',
         clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '30 seconds',
         'totp',clock_timestamp()-interval '30 seconds'
       )`,
      [CHALLENGE_ID, ACTOR_ID, SESSION_ID],
    );
    await database.query(
      `insert into private.reauth_events(
         user_id,session_id,challenge_id,aal,verification_method,verified_at
       ) select user_id,session_id,id,'aal2',factor_method,factor_verified_at
         from private.reauth_challenges where id=$1`,
      [CHALLENGE_ID],
    );
    await database.query(
      `insert into public.import_batches(
         id,organization_id,branch_id,uploaded_by,upload_idempotency_key,
         original_file_name,mime_type,encoding,file_size_bytes,sha256,mapping_version,
         status,raw_object_key,updated_at
       ) values(
         $1,$2,$3,$4,$5,'contract.html','text/html','utf-8',128,repeat('b',64),
         'contract-v1','mapping_required','private/page83-contract',
         '2026-09-07T18:00:00Z'::timestamptz
       )`,
      [IMPORT_ID, ORGANIZATION_ID, BRANCH_ID, ACTOR_ID, IMPORT_CORRELATION_ID],
    );
    await database.query(
      `insert into public.audit_events(
         organization_id,branch_id,actor_user_id,action,table_name,row_pk,request_id,
         idempotency_key,changed_fields,metadata,occurred_at
       ) values(
         $1,$2,$3,'integration','public.import_batches',$4,$5,$6,
         array['raw_object_key'],
         '{"token":"MUST_NOT_LEAVE_DATABASE","file_name":"PRIVATE"}'::jsonb,
         '2026-09-07T18:05:00Z'::timestamptz
       )`,
      [ORGANIZATION_ID, BRANCH_ID, ACTOR_ID, IMPORT_ID, AUDIT_REQUEST_ID,
        IMPORT_CORRELATION_ID],
    );
    await database.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({
      sub: ACTOR_ID,
      role: "authenticated",
      aal: "aal2",
      session_id: SESSION_ID,
    })]);
    await database.exec("set role authenticated");
  }, 60_000);

  beforeEach(async () => { await database.exec("begin"); });
  afterEach(async () => { await database.exec("rollback"); });
  afterAll(async () => { await database?.close(); });

  async function snapshot(filters: IntegrationsAuditFilters) {
    const { rows } = await database.query<{ value: IntegrationsAuditSnapshotSourceRow }>(
      `select to_jsonb(result) as value
       from public.integrations_audit_snapshot(
         $1::uuid,$2::uuid,$3::date,$4::date,$5::text,$6::text,$7::text,$8::text,
         $9::uuid,$10::uuid
       ) result`,
      [
        ORGANIZATION_ID, BRANCH_ID, filters.startDate, filters.endDate,
        filters.integrationKey, filters.activityState, filters.auditAction,
        filters.resourceCategory, filters.actorUserId, filters.correlationId,
      ],
    );
    expect(rows).toHaveLength(1);
    return projectIntegrationsAuditSnapshot({
      row: rows[0]!.value,
      expectedOrganizationId: ORGANIZATION_ID,
      expectedBranchId: BRANCH_ID,
      filters,
    });
  }

  it("projects the exact persisted import signal and redacted audit evidence", async () => {
    const actual = await snapshot(baseFilters);
    expect(actual.inventory).toEqual([expect.objectContaining({
      integrationKey: "central_html_import",
      activityState: "attention",
      recordTotal: 1,
      attentionTotal: 1,
      pendingTotal: 1,
    })]);
    expect(actual.signals).toEqual([expect.objectContaining({
      signalId: IMPORT_ID,
      correlationId: IMPORT_CORRELATION_ID,
      state: "pending",
      errorCategory: "import_mapping_required",
    })]);
    expect(actual.auditEvents).toEqual([expect.objectContaining({
      action: "integration",
      resourceCategory: "import",
      recordId: { kind: "uuid", value: IMPORT_ID },
      requestId: AUDIT_REQUEST_ID,
      idempotencyKey: IMPORT_CORRELATION_ID,
    })]);
    expect(JSON.stringify(actual)).not.toMatch(/MUST_NOT_LEAVE_DATABASE|PRIVATE|raw_object_key/u);
    expect(Date.parse(actual.staleAfter) - Date.parse(actual.generatedAt)).toBe(60_000);
  });

  it("uses persisted source idempotency UUIDs as an exact correlation filter", async () => {
    const exact = await snapshot({ ...baseFilters, correlationId: IMPORT_CORRELATION_ID });
    expect(exact.signalMatchingTotal).toBe(1);
    expect(exact.auditMatchingTotal).toBe(1);
    const unrelated = await snapshot({
      ...baseFilters,
      correlationId: "83df0000-0000-4000-8000-000000000001",
    });
    expect(unrelated.signalMatchingTotal).toBe(0);
    expect(unrelated.auditMatchingTotal).toBe(0);
    expect(unrelated.inventory[0]).toMatchObject({
      activityState: "no_activity",
      recordTotal: 0,
    });
  });

  it("denies direct authenticated access to raw audit metadata", async () => {
    await expect(database.query("select metadata from public.audit_events limit 1"))
      .rejects.toMatchObject({ code: "42501" });
  });
});
